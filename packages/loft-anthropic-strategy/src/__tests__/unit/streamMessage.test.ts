import * as fs from 'node:fs';
import * as path from 'node:path';

import Anthropic, { AnthropicError, APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import { isRetryableError, Logger, Strategy } from '@moc-global/loft-definitions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { anthropicUsageToUnified } from '../../adapters/usage';
import { AnthropicCallStrategy } from '../../AnthropicCallStrategy';
import { AnthropicLoftStrategy } from '../../AnthropicLoftStrategy';
import { AnthropicStrategyOptions } from '../../AnthropicStrategyOptions';
import { generateStreamed, streamMessage } from '../../streaming/streamMessage';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/stream');
const COMPLETED_FIXTURES = [
  'text',
  'tool-use',
  'parallel-tools',
  'thinking',
  'max-tokens',
  'refusal',
  'stop-sequence',
  'redacted-citations',
  'utf8-split',
  'thinking-omitted'
];

interface Fixture {
  /** The raw events the API sends, in order */
  events: { type: string }[];
  /** The message the same request returns without streaming */
  message: Anthropic.Message;
}

const readFixture = <T = Fixture>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8')) as T;

// One network chunk per server-sent event, as the API sends them
const sseChunks = (events: { type: string }[]): Uint8Array[] =>
  events.map((event) => new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));

// Fixed-size network chunks, which cut events, lines and UTF-8 code points
function byteChunks(events: { type: string }[], size: number): Uint8Array[] {
  const bytes = new Uint8Array(sseChunks(events).flatMap((chunk) => [...chunk]));
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
  return chunks;
}

interface SentRequest {
  url: string;
  body: Record<string, unknown>;
}

// A fetch that answers a streamed request with the fixture's events, one per read, and any other request with the
// fixture's message as JSON. Like a real fetch, an aborted request signal errors the body. `beforeChunk` runs before
// the chunk at that index is sent; `chunkSize` sends fixed-size chunks instead of one per event
function fakeFetch(name: string, beforeChunk?: (index: number) => void, chunkSize?: number) {
  const fixture = readFixture<Partial<Fixture> & { events: { type: string }[] }>(name);
  const requests: SentRequest[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url: String(input), body });
    if (!body.stream) {
      return new Response(JSON.stringify(fixture.message), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    const chunks = chunkSize ? byteChunks(fixture.events, chunkSize) : sseChunks(fixture.events);
    const signal = init?.signal;
    let next = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
      },
      pull(controller) {
        beforeChunk?.(next);
        if (signal?.aborted) return;
        const chunk = chunks[next++];
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      }
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { fetch, requests };
}

const BODY: Anthropic.MessageCreateParamsNonStreaming = {
  model: 'claude-haiku-5-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hi' }]
};

interface StreamOptions {
  sink?: Strategy.LLM.LlmStreamSink;
  signal?: AbortSignal;
  beforeChunk?: (index: number) => void;
  chunkSize?: number;
  body?: Anthropic.MessageCreateParamsNonStreaming;
}

function newClient(fetch: ReturnType<typeof fakeFetch>['fetch']): Anthropic {
  return new Anthropic({ apiKey: 'test-key', fetch, maxRetries: 0 });
}

function stream(name: string, options: StreamOptions = {}) {
  const events: Strategy.LLM.LlmStreamEvent[] = [];
  const { fetch, requests } = fakeFetch(name, options.beforeChunk, options.chunkSize);
  const onEvent: Strategy.LLM.LlmStreamSink = (event) => {
    events.push(event);
    return options.sink?.(event);
  };
  const result = streamMessage(newClient(fetch), options.body ?? BODY, { signal: options.signal, onEvent });
  return { result, events, requests };
}

// The message the same request returns from `messages.create`, without streaming
const nonStreamed = (name: string) => newClient(fakeFetch(name).fetch).messages.create(BODY);

const textOf = (events: Strategy.LLM.LlmStreamEvent[], type: 'text-delta' | 'reasoning-delta' = 'text-delta') =>
  events.map((event) => (event.type === type ? event.delta : '')).join('');

const loftStrategy = new AnthropicLoftStrategy({ llmName: 'claude' }, {} as Strategy.CallManager);
const format = (message: Anthropic.Message) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
  const { originalResponse, ...rest } = loftStrategy.formatToUnifiedLLMResponse(
    [],
    's-1',
    message,
    'claude',
    'assistant'
  );
  return rest;
};

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_BASE_URL', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each(COMPLETED_FIXTURES)('the %s stream', (name) => {
  it('finalMessage equals the non-streamed Message', async () => {
    const { result } = stream(name);
    const streamed = await result;

    expect(streamed).toEqual(readFixture(name).message);
    expect(streamed).toEqual(await nonStreamed(name));
    // The SDK adds `parsed_output` to a streamed message; the non-streamed one has no such key
    expect(streamed).not.toHaveProperty('parsed_output');
  });

  it('format(streamed) equals format(nonStreamed)', async () => {
    const { result } = stream(name);

    expect(format(await result)).toEqual(format(await nonStreamed(name)));
  });

  it('the usage events, a later value replacing an earlier one, add up to the unified usage of the message', async () => {
    const { result, events } = stream(name);
    const { usage, model, stop_reason } = await result;

    const merged = Object.assign(
      {},
      ...events.flatMap((event) => (event.type === 'usage' ? [event.usage] : []))
    ) as Partial<Strategy.LLM.StreamUsage>;

    expect(merged).toEqual(anthropicUsageToUnified(usage, model, stop_reason));
  });

  it('never emits request-start', async () => {
    const { result, events } = stream(name);
    await result;

    expect(events.some((event) => event.type === 'request-start')).toBe(false);
  });
});

describe('streamMessage events', () => {
  it('emits only text deltas as text', async () => {
    const { result, events } = stream('text');
    await result;

    expect(events).toEqual([
      { type: 'usage', usage: { inputTokens: 12, outputTokens: 1, totalTokens: 13, model: 'claude-haiku-5-5' } },
      { type: 'text-delta', delta: 'Hello' },
      { type: 'text-delta', delta: ', world!' },
      {
        type: 'usage',
        usage: { outputTokens: 6, totalTokens: 18, model: 'claude-haiku-5-5', finishReason: 'end_turn' }
      }
    ]);
  });

  it('thinking becomes reasoning-delta and signatures never leave', async () => {
    const { result, events } = stream('thinking');
    await result;

    expect(textOf(events, 'reasoning-delta')).toBe('The user wants a haiku about autumn.');
    expect(textOf(events)).toBe('Autumn moon rises.');
    // The signature delta only reports activity
    expect(events.filter((event) => event.type === 'activity')).toHaveLength(1);
    expect(JSON.stringify(events)).not.toMatch(/EqQBCkYIARgCIkBsecretSignatureBytes/);
  });

  it('thinking whose text is omitted sends nothing until its signature', async () => {
    const { result, events } = stream('thinking-omitted');
    await result;

    // Neither the empty block start nor the empty delta is reported, so only the usage of message_start comes before
    // the signature's activity: the call manager's idle timer does not start during the silent thinking
    expect(events.map((event) => event.type)).toEqual(['usage', 'activity', 'text-delta', 'usage']);
    expect(textOf(events, 'reasoning-delta')).toBe('');
  });

  it('tool input json becomes activity, never text', async () => {
    const { result, events } = stream('tool-use');
    await result;

    expect(textOf(events)).toBe('Let me check the weather.');
    // The tool_use block start and its three non-empty input deltas; the empty first delta is skipped
    expect(events.filter((event) => event.type === 'activity')).toHaveLength(4);
    expect(JSON.stringify(events)).not.toMatch(/get_weather|toolu_|city|Ky/);
  });

  it('parallel tool calls only report activity', async () => {
    const { result, events } = stream('parallel-tools');
    await result;

    expect(events.map((event) => event.type)).toEqual([
      'usage',
      'activity',
      'activity',
      'activity',
      'activity',
      'activity',
      'usage'
    ]);
    expect(JSON.stringify(events)).not.toMatch(/get_weather|get_time|Kyiv/);
  });

  it('redacted thinking and citations only report activity', async () => {
    const { result, events } = stream('redacted-citations');
    await result;

    expect(events.map((event) => event.type)).toEqual(['usage', 'activity', 'text-delta', 'activity', 'usage']);
    expect(JSON.stringify(events)).not.toMatch(/encryptedReasoning|Facts|char_location/);
  });

  it('usage events carry token counts', async () => {
    const { result, events } = stream('thinking');
    await result;

    expect(events.filter((event) => event.type === 'usage')).toEqual([
      {
        type: 'usage',
        usage: { inputTokens: 40, outputTokens: 4, totalTokens: 44, cacheTokens: 2048, model: 'claude-sonnet-5-5' }
      },
      {
        type: 'usage',
        usage: {
          inputTokens: 40,
          outputTokens: 77,
          totalTokens: 117,
          cacheTokens: 2048,
          model: 'claude-sonnet-5-5',
          finishReason: 'end_turn'
        }
      }
    ]);
  });

  it('text split across reads mid-event and mid-code-point arrives intact', async () => {
    const { events: fixtureEvents, message } = readFixture('utf8-split');
    const chunks = byteChunks(fixtureEvents, 7);
    // At least one chunk starts inside a multi-byte code point (with a UTF-8 continuation byte)
    expect(chunks.some((chunk) => (chunk[0]! & 0xc0) === 0x80)).toBe(true);

    const whole = stream('utf8-split');
    const split = stream('utf8-split', { chunkSize: 7 });

    expect(await split.result).toEqual(message);
    expect(await split.result).toEqual(await whole.result);
    expect(split.events).toEqual(whole.events);
    expect(textOf(split.events)).toBe('Привіт, світе 👋🏽 — 日本語');
  });

  it('a max_tokens stop is returned as it is', async () => {
    const { result, events } = stream('max-tokens');

    expect((await result).stop_reason).toBe('max_tokens');
    expect(textOf(events)).toBe('Once upon a time, in a');
  });

  it('sends the request with stream: true', async () => {
    const { result, requests } = stream('text');
    await result;

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain('/v1/messages');
    expect(requests[0]?.body).toMatchObject({ ...BODY, stream: true });
  });

  it('leaves out the parsed_output the SDK adds for structured outputs', async () => {
    const body: Anthropic.MessageCreateParamsNonStreaming = {
      ...BODY,
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } } }
    };
    const { result } = stream('text', { body });

    expect(await result).toEqual(readFixture('text').message);
    expect(await result).not.toHaveProperty('parsed_output');
  });

  it('a throwing sink does not break the result', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const sink = vi.fn(() => {
      throw new Error('consumer failed');
    });
    const { result } = stream('tool-use', { sink });

    expect(await result).toEqual(readFixture('tool-use').message);
    expect(sink).toHaveBeenCalledTimes(8);
    // Logged once, by event type only
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/consumer failed|Let me check/);
  });

  it('ignores what the sink returns', async () => {
    const { result } = stream('text', { sink: () => false });

    expect(await result).toEqual(readFixture('text').message);
  });
});

describe('streamed failures', () => {
  const midStreamError = () =>
    readFixture<{ error: { type: string; error: { type: string } }; textBeforeError: string }>('mid-stream-error');

  it('mid-stream overloaded error rejects with the SDK error', async () => {
    const { result, events } = stream('mid-stream-error');

    const error = await result.catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({ status: undefined, type: 'overloaded_error', error: midStreamError().error });
    expect(textOf(events)).toBe(midStreamError().textBeforeError);
  });

  it('the mid-stream overloaded error is retryable: it has no status and the type overloaded_error', async () => {
    const error = await stream('mid-stream-error').result.catch((caught: unknown) => caught);

    expect(isRetryableError(error)).toBe(true);
  });

  it('logs the class, status, type and code of the error, never its message', async () => {
    const logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { fetch } = fakeFetch('mid-stream-error');

    await expect(generateStreamed(newClient(fetch), BODY, { onEvent: () => {} })).rejects.toBeInstanceOf(APIError);

    expect(logError).toHaveBeenCalledWith('streamed generate failed', {
      name: 'APIError',
      status: undefined,
      type: 'overloaded_error',
      code: undefined
    });
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/Overloaded|Partial/);
  });
});

describe('a stream cut short', () => {
  // A fetch whose event stream ends cleanly after the given chunks
  const fetchOf = (chunks: Uint8Array[]) => async () => {
    let next = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[next++];
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      }
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const failure = (chunks: Uint8Array[]) =>
    streamMessage(newClient(fetchOf(chunks)), BODY, { onEvent: () => {} }).catch((caught: unknown) => caught);
  const chunks = sseChunks(readFixture('text').events);

  const expectConnectionError = (error: unknown) => {
    expect(error).toBeInstanceOf(APIConnectionError);
    expect((error as APIConnectionError).cause).toBeInstanceOf(AnthropicError);
    expect(isRetryableError(error)).toBe(true);
  };

  it('rejects with a retryable APIConnectionError, the SDK error as its cause, when it ends before message_stop', async () => {
    expectConnectionError(await failure(chunks.slice(0, -1)));
    expectConnectionError(await failure(chunks.slice(0, 3)));
  });

  describe('a connection that fails after message_stop', () => {
    // A fetch whose event stream sends every event and then fails as a closed socket does; the SDK reports that as
    // its own AnthropicError
    const fetchFailingAfter = (sent: Uint8Array[], onTail?: () => void) => async () => {
      let next = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = sent[next++];
          if (chunk) return controller.enqueue(chunk);
          onTail?.();
          controller.error(new TypeError('terminated'));
        }
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };

    it('resolves with the message, as the reply had finished', async () => {
      const message = await streamMessage(newClient(fetchFailingAfter(chunks)), BODY, { onEvent: () => {} });

      expect(message).toEqual(await nonStreamed('text'));
    });

    it('rejects with the abort error when the signal aborted', async () => {
      const controller = new AbortController();
      const client = newClient(fetchFailingAfter(chunks, () => controller.abort()));

      const error = await streamMessage(client, BODY, { signal: controller.signal, onEvent: () => {} }).catch(
        (caught: unknown) => caught
      );

      expect(error).toBeInstanceOf(APIUserAbortError);
    });

    it('still rejects with a retryable error when it fails before message_stop', async () => {
      const error = await streamMessage(newClient(fetchFailingAfter(chunks.slice(0, -1))), BODY, {
        onEvent: () => {}
      }).catch((caught: unknown) => caught);

      expectConnectionError(error);
    });
  });

  it('rejects with a retryable APIConnectionError when it ends before any event', async () => {
    expectConnectionError(await failure([]));
  });

  it('rejects with a retryable APIConnectionError when it ends inside an event', async () => {
    const partial = chunks[2]!.slice(0, 30);

    expectConnectionError(await failure([...chunks.slice(0, 2), partial]));
  });

  it('rejects with the error as it is, not retryable, when it fails before the response arrived', async () => {
    const client = new Anthropic({ apiKey: null, authToken: null, fetch: fetchOf(chunks), maxRetries: 0 });

    const error = await streamMessage(client, BODY, { onEvent: () => {} }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(APIConnectionError);
    expect(isRetryableError(error)).toBe(false);
  });

  it('rejects with the abort error when the signal aborted and the stream was cut short', async () => {
    const cut = new AnthropicError('stream ended without producing a Message with role=assistant');
    // A connected stream that ends with the SDK's error for a body cut short
    const cutStream = {
      on(event: string, listener: () => void) {
        if (event === 'connect') listener();
      },
      async *[Symbol.asyncIterator]() {
        yield* [];
        throw cut;
      },
      finalMessage: async () => Promise.reject(cut)
    };
    const client = { messages: { stream: () => cutStream } } as unknown as Anthropic;
    const controller = new AbortController();
    controller.abort();

    const error = await streamMessage(client, BODY, { signal: controller.signal, onEvent: () => {} }).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(APIUserAbortError);
    expect(isRetryableError(error)).toBe(false);
  });

  it('still rejects with the API error of an error event', async () => {
    const error = await stream('mid-stream-error').result.catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(APIError);
    expect(error).not.toBeInstanceOf(APIConnectionError);
  });
});

describe('an aborted stream', () => {
  const expectAbortError = (error: unknown) => {
    expect(error).toBeInstanceOf(APIUserAbortError);
    expect(isRetryableError(error)).toBe(false);
  };

  it('passes the signal: an abort mid-stream rejects with the SDK abort error', async () => {
    const controller = new AbortController();
    const { result, events } = stream('text', {
      signal: controller.signal,
      sink: (event) => {
        if (event.type === 'text-delta') controller.abort();
      }
    });

    expectAbortError(await result.catch((caught: unknown) => caught));
    expect(textOf(events)).toBe('Hello');
  });

  it('rejects with the abort error when aborted after the last event was read', async () => {
    const controller = new AbortController();
    const events = readFixture('text').events;
    const { result } = stream('text', {
      signal: controller.signal,
      beforeChunk: (index) => index === events.length && controller.abort()
    });

    expectAbortError(await result.catch((caught: unknown) => caught));
  });

  it('rejects with the abort error when aborted on the last usage event', async () => {
    const controller = new AbortController();
    const { result } = stream('text', {
      signal: controller.signal,
      sink: (event) => {
        if (event.type === 'usage' && event.usage.finishReason) controller.abort();
      }
    });

    expectAbortError(await result.catch((caught: unknown) => caught));
  });

  it('rejects with the abort error when the stream had already finished before the abort', async () => {
    // A stream whose events all arrived and whose message is complete, as the SDK's is once it has read the last event
    const { events, message } = readFixture('text');
    const finished = {
      on: () => undefined,
      async *[Symbol.asyncIterator]() {
        for (const event of events) yield event;
      },
      finalMessage: async () => message
    };
    const client = { messages: { stream: () => finished } } as unknown as Anthropic;
    const controller = new AbortController();
    const onEvent: Strategy.LLM.LlmStreamSink = (event) => {
      if (event.type === 'usage' && event.usage.finishReason) controller.abort();
    };

    const result = streamMessage(client, BODY, { signal: controller.signal, onEvent });

    expectAbortError(await result.catch((caught: unknown) => caught));
  });

  it('rejects with the abort error when the signal is already aborted', async () => {
    const { result, requests } = stream('text', { signal: AbortSignal.abort() });

    expectAbortError(await result.catch((caught: unknown) => caught));
    expect(requests).toHaveLength(0);
  });
});

describe('the call strategy', () => {
  function newStrategy(name: string, options?: AnthropicStrategyOptions) {
    const served = fakeFetch(name);
    const strategy = new AnthropicCallStrategy(
      { apiKey: 'test-key', fetch: served.fetch, maxRetries: 0 },
      {} as Strategy.LLM.LlmTokenRateLimiter,
      {} as Strategy.LLM.LlmTokenizer,
      options
    );
    return { strategy, requests: served.requests };
  }

  it('generate streams with onEvent and resolves with the same Message', async () => {
    const { strategy, requests } = newStrategy('tool-use');
    const events: Strategy.LLM.LlmStreamEvent[] = [];

    const response = await strategy.generate<Anthropic.MessageCreateParams, Anthropic.Message>(
      { ...BODY, stream: true },
      { onEvent: (event) => void events.push(event) }
    );

    expect(response).toEqual(readFixture('tool-use').message);
    expect(strategy.extractUsedTokens(response)).toBe(468);
    expect(textOf(events)).toBe('Let me check the weather.');
    expect(requests[0]?.body).toMatchObject({ model: BODY.model, stream: true });
  });

  it('streaming false ignores onEvent', async () => {
    const { strategy, requests } = newStrategy('text', { streaming: false });
    const onEvent = vi.fn();

    await expect(strategy.generate(BODY, { onEvent })).resolves.toEqual(readFixture('text').message);

    expect(requests[0]?.body).toMatchObject({ stream: false });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('no onEvent uses create', async () => {
    const { strategy, requests } = newStrategy('text');

    await expect(strategy.generate(BODY)).resolves.toEqual(readFixture('text').message);

    expect(requests[0]?.body).toMatchObject({ stream: false });
  });

  it('logs a request that cannot be built without its content, and rethrows', async () => {
    const logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { strategy, requests } = newStrategy('text');

    await expect(strategy.generate(null, { onEvent: () => {} })).rejects.toBeInstanceOf(TypeError);

    expect(logError).toHaveBeenCalledWith('streamed generate failed', expect.objectContaining({ name: 'TypeError' }));
    expect(requests).toHaveLength(0);
  });

  it('rejects with the SDK error when the stream fails', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { strategy } = newStrategy('mid-stream-error');

    await expect(strategy.generate(BODY, { onEvent: () => {} })).rejects.toBeInstanceOf(APIError);
  });
});
