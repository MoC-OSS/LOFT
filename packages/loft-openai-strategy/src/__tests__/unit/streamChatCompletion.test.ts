import * as fs from 'node:fs';
import * as path from 'node:path';

import { isRetryableError, Logger, Strategy } from '@moc-global/loft-definitions';
import OpenAI, { APIConnectionError, APIError, APIUserAbortError } from 'openai';
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AzureOpenAiCallStrategy } from '../../AzureOpenAiCallStrategy';
import { OpenAiCallStrategy } from '../../OpenAiCallStrategy';
import { OpenAiLoftStrategy } from '../../OpenAiLoftStrategy';
import { OpenAiStrategyOptions } from '../../OpenAiStrategyOptions';
import { OpenAiRequest } from '../../OpenAiTypes';
import { accumulateChatCompletion, ChatCompletionAccumulator } from '../../streaming/accumulateChatCompletion';
import {
  CreateChatCompletionStream,
  generateStreamed,
  isStreamable,
  streamChatCompletion
} from '../../streaming/streamChatCompletion';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/stream');
const COMPLETED_FIXTURES = [
  'text',
  'tool-calls',
  'parallel-tools',
  'refusal',
  'n2',
  'usage-last',
  'utf8-split',
  'azure-prompt-filter',
  'content-filter-midstream'
];

const readSse = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.sse`)));
const readProjection = <T = ChatCompletion>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8')) as T;

// The chunks of a fixture as the SDK yields them, for the accumulator alone
const parseSse = (name: string): ChatCompletionChunk[] =>
  new TextDecoder()
    .decode(readSse(name))
    .split('\n\n')
    .map((event) => event.replace(/^data: /, ''))
    .filter((data) => data && data !== '[DONE]')
    .map((data) => JSON.parse(data) as ChatCompletionChunk);

// One network chunk per SSE event, as the API usually sends them
function eventChunks(bytes: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (let i = 1; i < bytes.length; i++) {
    if (bytes[i - 1] === 0x0a && bytes[i] === 0x0a) {
      chunks.push(bytes.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < bytes.length) chunks.push(bytes.slice(start));
  return chunks;
}

// Fixed-size network chunks, which cut events, lines and UTF-8 code points
function byteChunks(bytes: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
  return chunks;
}

interface SentRequest {
  url: string;
  body: Record<string, unknown>;
}

// A fetch that answers every request with the given byte chunks as an event stream, one chunk per read. Like a real
// fetch, an aborted request signal errors the body. `beforeChunk` runs before the chunk at that index is sent
function fakeFetch(chunks: Uint8Array[], beforeChunk?: (index: number) => void) {
  const requests: SentRequest[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const signal = init?.signal;
    let next = 0;
    const body = new ReadableStream<Uint8Array>({
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
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { fetch, requests };
}

type ClientFactory = (fetch: ReturnType<typeof fakeFetch>['fetch']) => Promise<CreateChatCompletionStream>;

const openAiV7: ClientFactory = async (fetch) => {
  const client = new OpenAI({ apiKey: 'x', fetch, maxRetries: 0 });
  return (body, options) => client.chat.completions.create(body, options);
};

const openAiV4: ClientFactory = async (fetch) => {
  const OpenAiV4 = (await import('openai-v4')).default;
  const client = new OpenAiV4({ apiKey: 'x', fetch: fetch as never, maxRetries: 0 });
  // The v4 types differ from v7 only in fields these requests and chunks do not use
  return (body, options) =>
    client.chat.completions.create(body as never, options) as unknown as ReturnType<CreateChatCompletionStream>;
};

const REQUEST: OpenAiRequest = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hi' }] };

interface StreamOptions {
  client?: ClientFactory;
  chunks?: Uint8Array[];
  includeUsage?: boolean;
  sink?: (event: Strategy.LLM.LlmStreamEvent) => void;
  signal?: AbortSignal;
  beforeChunk?: (index: number) => void;
}

async function stream(name: string, options: StreamOptions = {}) {
  const { client = openAiV7, chunks = eventChunks(readSse(name)), includeUsage = true, sink, signal } = options;
  const events: Strategy.LLM.LlmStreamEvent[] = [];
  const { fetch, requests } = fakeFetch(chunks, options.beforeChunk);
  const create = await client(fetch);
  const onEvent: Strategy.LLM.LlmStreamSink = (event) => {
    events.push(event);
    sink?.(event);
  };
  const result = streamChatCompletion(create, REQUEST, { signal, onEvent, includeUsage });
  return { result, events, requests };
}

const textOf = (events: Strategy.LLM.LlmStreamEvent[]) =>
  events.map((event) => (event.type === 'text-delta' ? event.delta : '')).join('');

const loftStrategy = new OpenAiLoftStrategy({ llmName: 'gpt' }, {} as Strategy.CallManager);
const formatWithoutOriginal = (response: ChatCompletion) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
  const { originalResponse, ...rest } = loftStrategy.formatToUnifiedLLMResponse(
    [],
    's-1',
    response,
    'gpt',
    'assistant'
  );
  return rest;
};

const sdkShape = ({ model, object, usage, choices }: ChatCompletion) => ({
  model,
  object,
  ...(usage && { usage }),
  choices: choices.map(({ index, finish_reason, message }) => ({
    index,
    finish_reason,
    message: {
      role: message.role,
      content: message.content,
      refusal: message.refusal,
      ...(message.tool_calls && { tool_calls: message.tool_calls })
    }
  }))
});

describe.each(COMPLETED_FIXTURES)('the %s stream', (name) => {
  it('format(streamed) minus originalResponse equals the projection', async () => {
    const { result } = await stream(name);

    expect(formatWithoutOriginal(await result)).toEqual(formatWithoutOriginal(readProjection(name)));
  });

  it('originalResponse matches {model, object, usage, choices[{index, finish_reason, message{role, content, refusal, tool_calls}}]}', async () => {
    const { result } = await stream(name);

    expect(await result).toMatchObject(sdkShape(readProjection(name)));
  });

  it('accumulates to the projection, provider extras included', async () => {
    const { result } = await stream(name);

    expect(await result).toEqual(readProjection(name));
    expect(accumulateChatCompletion(parseSse(name))).toEqual(readProjection(name));
  });
});

describe('streamChatCompletion events', () => {
  it('emits only choice-0 text', async () => {
    const { result, events } = await stream('n2');
    await result;

    expect(textOf(events)).toBe('Red sky');
    // The second choice's chunks are kept back but still show the stream is alive
    expect(events.filter((event) => event.type === 'activity')).toHaveLength(2);
  });

  it('utf8-split arrives intact', async () => {
    const bytes = readSse('utf8-split');
    const chunks = byteChunks(bytes, 5);
    // At least one chunk starts inside a multi-byte code point (with a UTF-8 continuation byte)
    expect(chunks.some((chunk) => (chunk[0]! & 0xc0) === 0x80)).toBe(true);

    const { result, events } = await stream('utf8-split', { chunks });

    expect((await result).choices[0]?.message.content).toBe('Привіт, світе 👋🏽 — 日本語');
    expect(textOf(events)).toBe('Привіт, світе 👋🏽 — 日本語');
  });

  it('tool-call chunks emit activity, never their text', async () => {
    const { result, events } = await stream('tool-calls');
    await result;

    expect(events.filter((event) => event.type === 'text-delta')).toEqual([]);
    expect(events.filter((event) => event.type === 'activity')).toHaveLength(4);
    expect(JSON.stringify(events)).not.toMatch(/get_weather|Par|call_Wx1/);
  });

  it('empty and usage-only chunks emit no text or activity', async () => {
    const { result, events } = await stream('usage-last');
    await result;

    expect(events).toEqual([
      { type: 'text-delta', delta: 'Forty-two.' },
      {
        type: 'usage',
        usage: {
          inputTokens: 25,
          outputTokens: 210,
          totalTokens: 235,
          reasoningTokens: 192,
          model: 'o4-mini-2025-04-16',
          finishReason: 'stop'
        }
      }
    ]);
  });

  it('emits a refusal as text', async () => {
    const { result, events } = await stream('refusal');
    await result;

    expect(textOf(events)).toBe("I'm sorry, I can't help with that.");
  });

  it('azure empty-id first chunk is ignored for id', async () => {
    const { result, events } = await stream('azure-prompt-filter');
    const completion = await result;

    expect(completion).toMatchObject({ id: 'chatcmpl-AzPf0001', model: 'gpt-4o-2024-11-20', created: 1761130000 });
    expect(completion).toHaveProperty('prompt_filter_results');
    expect(events.map((event) => event.type)).toEqual(['text-delta', 'text-delta', 'usage']);
  });

  it('content_filter finish is returned, not thrown', async () => {
    const { result, events } = await stream('content-filter-midstream');
    const completion = await result;

    expect(completion.choices[0]?.finish_reason).toBe('content_filter');
    expect(textOf(events)).toBe('The battle began');
  });

  it('mid-stream error rejects with the SDK error', async () => {
    const expected = readProjection<{ error: object; textBeforeError: string }>('mid-stream-error');
    const { result, events } = await stream('mid-stream-error');

    const error = await result.catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({ status: undefined, error: expected.error });
    expect(textOf(events)).toBe(expected.textBeforeError);
  });

  it('keeps streaming when the sink throws', async () => {
    const sink = vi.fn(() => {
      throw new Error('consumer failed');
    });
    const { result } = await stream('text', { sink });

    expect((await result).choices[0]?.message.content).toBe('Hello, world!');
    expect(sink).toHaveBeenCalledTimes(3);
  });

  it('asks for usage in the stream unless told not to', async () => {
    const withUsage = await stream('usage-last');
    await withUsage.result;
    const withoutUsage = await stream('text', { includeUsage: false });
    await withoutUsage.result;

    expect(withUsage.requests[0]?.body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(withoutUsage.requests[0]?.body).toMatchObject({ stream: true });
    expect(withoutUsage.requests[0]?.body).not.toHaveProperty('stream_options');
  });

  it('passes the signal', async () => {
    const { signal } = new AbortController();
    const create = vi.fn(async () => (async function* () {})());

    await expect(
      streamChatCompletion(create, REQUEST, { signal, onEvent: () => {}, includeUsage: true })
    ).rejects.toThrow(APIConnectionError);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ stream: true }), { signal });
  });

  it.each(COMPLETED_FIXTURES)('same results on openai-v4: %s', async (name) => {
    const v7 = await stream(name);
    const v4 = await stream(name, { client: openAiV4 });

    expect(await v4.result).toEqual(await v7.result);
    expect(v4.events).toEqual(v7.events);
    expect(v4.requests[0]?.body).toEqual(v7.requests[0]?.body);
  });

  it('same results on openai-v4: utf8-split in byte chunks and mid-stream-error', async () => {
    const chunks = byteChunks(readSse('utf8-split'), 5);
    const v4 = await stream('utf8-split', { client: openAiV4, chunks });
    expect(await v4.result).toEqual(readProjection('utf8-split'));

    const failed = await stream('mid-stream-error', { client: openAiV4 });
    const error = await failed.result.catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      status: undefined,
      error: readProjection<{ error: object }>('mid-stream-error').error
    });
    expect(textOf(failed.events)).toBe('Partial');
  });
});

describe.each([
  ['openai', openAiV7],
  ['openai-v4', openAiV4]
])('an aborted stream on %s', (_name, client) => {
  // The SDK ends the chunks quietly on an abort; the call must still reject like a non-streamed one
  const expectAbortError = (error: unknown) => {
    expect(error).toBeInstanceOf(APIUserAbortError);
    expect(isRetryableError(error)).toBe(false);
  };

  it('rejects with the abort error when aborted mid-stream', async () => {
    const controller = new AbortController();
    const { result, events } = await stream('text', {
      client,
      signal: controller.signal,
      sink: () => controller.abort()
    });

    expectAbortError(await result.catch((caught: unknown) => caught));
    expect(textOf(events)).toBe('Hello');
  });

  it('rejects with the abort error when aborted after the finish chunk, before the usage chunk', async () => {
    const controller = new AbortController();
    // usage-last sends the role, the text, the finish and then the usage chunk
    const { result } = await stream('usage-last', {
      client,
      signal: controller.signal,
      beforeChunk: (index) => index === 3 && controller.abort()
    });

    expectAbortError(await result.catch((caught: unknown) => caught));
  });
});

describe('a stream cut short', () => {
  // usage-last sends the role, the text, the finish and the usage chunk, then [DONE]
  const bytes = readSse('usage-last');
  const events = eventChunks(bytes);
  const upTo = (count: number) => events.slice(0, count);
  const encode = (text: string) => new TextEncoder().encode(text);

  it('rejects with a retryable APIConnectionError, the SDK error as its cause, when it ends inside an event', async () => {
    const cut = upTo(2).reduce((length, chunk) => length + chunk.length, 0) + 40;
    const { result } = await stream('usage-last', { chunks: [bytes.slice(0, cut)] });

    const error = await result.catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(APIConnectionError);
    expect((error as APIConnectionError).cause).toBeInstanceOf(SyntaxError);
    expect(isRetryableError(error)).toBe(true);
  });

  it('rejects with a retryable APIConnectionError when it ends between events, before the finish', async () => {
    for (const client of [openAiV7, openAiV4]) {
      const { result } = await stream('usage-last', { client, chunks: upTo(2) });

      const error = await result.catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(APIConnectionError);
      expect(isRetryableError(error)).toBe(true);
    }
  });

  it('resolves with the full result when it ends inside the [DONE] line', async () => {
    const { result } = await stream('usage-last', { chunks: [...upTo(4), encode('data: [DO')] });

    expect(await result).toEqual(readProjection('usage-last'));
  });

  it('resolves without the usage when it ends after the finish, inside the usage chunk', async () => {
    const usageChunk = events[3]!;
    const { result } = await stream('usage-last', { chunks: [...upTo(3), usageChunk.slice(0, 60)] });

    const completion = await result;

    expect(completion.usage).toBeUndefined();
    expect(completion).toEqual({ ...readProjection('usage-last'), usage: undefined });
  });

  it('still rejects with the API error sent after every choice finished', async () => {
    const error = encode('data: {"error":{"message":"overloaded","type":"server_error","param":null,"code":null}}\n\n');
    const { result } = await stream('usage-last', { chunks: [...upTo(3), error] });

    await expect(result).rejects.toBeInstanceOf(APIError);
    await expect(result).rejects.not.toBeInstanceOf(APIConnectionError);
  });

  it('takes a whole last event without its blank line as it is: the finish resolves, an earlier event rejects', async () => {
    const withoutBlankLine = (event: Uint8Array) => event.slice(0, -2);
    const finish = await stream('usage-last', { chunks: [...upTo(2), withoutBlankLine(events[2]!)] });
    const text = await stream('usage-last', { chunks: [...upTo(1), withoutBlankLine(events[1]!)] });

    expect(await finish.result).toEqual({ ...readProjection('usage-last'), usage: undefined });
    const error = await text.result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(APIConnectionError);
    expect(isRetryableError(error)).toBe(true);
  });

  // A stream that yields the chunks, then throws `error` if one is given
  const failing =
    (chunks: ChatCompletionChunk[], error?: unknown): CreateChatCompletionStream =>
    async () =>
      (async function* () {
        yield* chunks;
        if (error !== undefined) throw error;
      })();
  const chunkOf = (index: number, delta: { content?: string }, finishReason: 'stop' | null): ChatCompletionChunk => ({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-4o',
    choices: [{ index, delta, logprobs: null, finish_reason: finishReason }]
  });

  it('rejects with the abort error when the signal aborted and the SDK failed to parse the cut event', async () => {
    const controller = new AbortController();
    controller.abort();
    const create = failing([chunkOf(0, { content: 'Hi' }, null)], new SyntaxError('malformed'));

    const error = await streamChatCompletion(create, REQUEST, {
      signal: controller.signal,
      onEvent: () => {},
      includeUsage: true
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(APIUserAbortError);
  });

  it('with n = 2, rejects when it ends before the second choice sent anything', async () => {
    const firstOnly = [chunkOf(0, { content: 'Red' }, null), chunkOf(0, {}, 'stop')];
    const options = { onEvent: () => {}, includeUsage: true };

    for (const create of [failing(firstOnly, new SyntaxError('malformed')), failing(firstOnly)]) {
      const error = await streamChatCompletion(create, { ...REQUEST, n: 2 }, options).catch(
        (caught: unknown) => caught
      );

      expect(error).toBeInstanceOf(APIConnectionError);
      expect(isRetryableError(error)).toBe(true);
    }
    // Without n the first choice is the whole reply
    await expect(
      streamChatCompletion(failing(firstOnly, new SyntaxError('malformed')), REQUEST, options)
    ).resolves.toMatchObject({ choices: [{ message: { content: 'Red' } }] });
  });
});

describe('streamed failures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the mid-stream error is retryable: it has no status and the type server_error', async () => {
    const { result } = await stream('mid-stream-error');
    const error = await result.catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: undefined, type: 'server_error' });
    expect(isRetryableError(error)).toBe(true);
  });

  it('logs the class, status, type and code of the error, never its message', async () => {
    const logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { fetch } = fakeFetch(eventChunks(readSse('mid-stream-error')));
    const create = await openAiV7(fetch);

    await expect(generateStreamed(create, REQUEST, { onEvent: () => {}, includeUsage: true })).rejects.toBeInstanceOf(
      APIError
    );

    expect(logError).toHaveBeenCalledWith('streamed generate failed', {
      name: 'APIError',
      status: undefined,
      type: 'server_error',
      code: null
    });
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/server had an error|Partial/);
  });
});

describe('isStreamable', () => {
  it('is false for a json_schema response format or a strict tool', () => {
    expect(
      isStreamable({ ...REQUEST, response_format: { type: 'json_schema', json_schema: { name: 'answer' } } })
    ).toBe(false);
    expect(
      isStreamable({ ...REQUEST, tools: [{ type: 'function', function: { name: 'lookup', strict: true } }] })
    ).toBe(false);
  });

  it('is true for other requests', () => {
    expect(isStreamable(REQUEST)).toBe(true);
    expect(isStreamable({ ...REQUEST, response_format: { type: 'json_object' } })).toBe(true);
    expect(isStreamable({ ...REQUEST, tools: [{ type: 'function', function: { name: 'lookup' } }] })).toBe(true);
  });
});

describe('accumulateChatCompletion', () => {
  const chunk = (choices: ChatCompletionChunk['choices']): ChatCompletionChunk => ({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-4o',
    choices
  });
  const logprob = (token: string) => ({ token, logprob: -0.1, bytes: null, top_logprobs: [] });

  it('merges logprobs, custom tool calls, function calls and audio', () => {
    const completion = accumulateChatCompletion([
      chunk([
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [{ index: 0, id: 'call_c1', type: 'custom', custom: { name: 'grammar', input: 'a' } }],
            function_call: { name: 'legacy', arguments: '{"a"' },
            audio: { id: 'audio_1', data: 'AAA', transcript: 'He' }
          },
          finish_reason: null,
          logprobs: { content: [logprob('He')], refusal: null }
        }
      ]),
      chunk([
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, custom: { input: 'b' } }],
            function_call: { arguments: ':1}' },
            audio: { data: 'BBB', transcript: 'llo', expires_at: 99 }
          },
          finish_reason: 'stop',
          logprobs: { content: [logprob('llo')], refusal: null }
        }
      ])
    ]);

    expect(completion.choices[0]).toEqual({
      index: 0,
      finish_reason: 'stop',
      logprobs: { content: [logprob('He'), logprob('llo')], refusal: null },
      message: {
        role: 'assistant',
        content: null,
        refusal: null,
        tool_calls: [{ id: 'call_c1', type: 'custom', custom: { name: 'grammar', input: 'ab' } }],
        function_call: { name: 'legacy', arguments: '{"a":1}' },
        audio: { id: 'audio_1', data: 'AAABBB', transcript: 'Hello', expires_at: 99 }
      }
    });
  });

  it('logprobs: null until a chunk sends them, per choice, and in order', () => {
    const withLogprobs = (
      index: number,
      logprobs: ChatCompletionChunk.Choice['logprobs'],
      finishReason: 'stop' | null
    ) => chunk([{ index, delta: { content: 'x' }, finish_reason: finishReason, logprobs }]);

    const completion = accumulateChatCompletion([
      withLogprobs(0, null, null),
      withLogprobs(1, { content: [], refusal: null }, null),
      withLogprobs(0, { content: [logprob('a')], refusal: null }, null),
      withLogprobs(1, null, null),
      withLogprobs(0, { content: null, refusal: [logprob('no')] }, null),
      withLogprobs(1, { content: [logprob('b')], refusal: null }, 'stop'),
      withLogprobs(0, { content: [logprob('c'), logprob('d')], refusal: null }, 'stop')
    ]);
    const untouched = accumulateChatCompletion([withLogprobs(0, null, 'stop')]);

    expect(completion.choices.map((choice) => choice.logprobs)).toEqual([
      { content: [logprob('a'), logprob('c'), logprob('d')], refusal: [logprob('no')] },
      { content: [logprob('b')], refusal: null }
    ]);
    expect(untouched.choices[0]?.logprobs).toBeNull();
  });

  it('logprobs: a completion already returned does not change, nor does a chunk', () => {
    const first = { content: [logprob('a')], refusal: null };
    const accumulator = new ChatCompletionAccumulator();
    accumulator.add(chunk([{ index: 0, delta: { content: 'a' }, finish_reason: 'stop', logprobs: first }]));
    const before = accumulator.result();
    accumulator.add(chunk([{ index: 0, delta: {}, finish_reason: 'stop', logprobs: first }]));

    expect(before.choices[0]?.logprobs?.content).toEqual([logprob('a')]);
    expect(accumulator.result().choices[0]?.logprobs?.content).toEqual([logprob('a'), logprob('a')]);
    expect(first.content).toEqual([logprob('a')]);
  });

  it('logprobs of a long stream add up in linear time', () => {
    const tokens = 5;
    const streamOf = (length: number) =>
      Array.from({ length }, (_, index) =>
        chunk([
          {
            index: 0,
            delta: { content: 'x' },
            finish_reason: index === length - 1 ? 'stop' : null,
            logprobs: { content: Array.from({ length: tokens }, () => logprob('x')), refusal: null }
          }
        ])
      );
    // The fastest of a few runs, so a pause of the garbage collector does not count
    const fastest = (chunks: ChatCompletionChunk[]) => {
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 5; run++) {
        const started = performance.now();
        const completion = accumulateChatCompletion(chunks);
        best = Math.min(best, performance.now() - started);
        expect(completion.choices[0]?.logprobs?.content).toHaveLength(chunks.length * tokens);
      }
      return best;
    };
    const short = streamOf(2_500);
    const long = streamOf(10_000);
    fastest(short);

    // Four times the chunks: about four times the time when each chunk is added, about sixteen when the list so far is
    // copied for every chunk. The bound sits between the two, with room for a loaded machine
    expect(fastest(long) / fastest(short)).toBeLessThan(12);
  });

  it('concatenates a text field it does not map that arrives in fragments', () => {
    // OpenAI-compatible endpoints stream fields such as reasoning_content a fragment at a time
    const withExtra = (delta: object, finishReason: 'stop' | null): ChatCompletionChunk =>
      chunk([{ index: 0, delta: delta as ChatCompletionChunk.Choice.Delta, finish_reason: finishReason }]);

    const completion = accumulateChatCompletion([
      withExtra({ role: 'assistant', reasoning_content: 'Think' }, null),
      withExtra({ reasoning_content: 'ing.' }, null),
      withExtra({ content: 'Done' }, 'stop')
    ]);

    expect(completion.choices[0]?.message).toEqual({
      role: 'assistant',
      content: 'Done',
      refusal: null,
      reasoning_content: 'Thinking.'
    });
  });

  it('keeps delta fields it does not map on the message, concatenating lists', () => {
    const citation = (url: string) => ({
      type: 'url_citation',
      url_citation: { url, title: url, start_index: 0, end_index: 1 }
    });
    // The SDK types do not list annotations on a delta, though the search models stream them there
    const withAnnotations = (delta: object, finishReason: 'stop' | null): ChatCompletionChunk =>
      chunk([{ index: 0, delta: delta as ChatCompletionChunk.Choice.Delta, finish_reason: finishReason }]);

    const completion = accumulateChatCompletion([
      withAnnotations({ role: 'assistant', content: 'See', annotations: [citation('https://a.example')] }, null),
      withAnnotations({ content: ' this', annotations: [citation('https://b.example')], annotations_version: 1 }, null),
      withAnnotations({ annotations: null, annotations_version: 2 }, 'stop')
    ]);

    expect(completion.choices[0]?.message).toEqual({
      role: 'assistant',
      content: 'See this',
      refusal: null,
      annotations: [citation('https://a.example'), citation('https://b.example')],
      annotations_version: 2
    });
  });

  it('throws when the stream ends before every choice finished', () => {
    const unfinished = chunk([{ index: 0, delta: { content: 'Hel' }, finish_reason: null }]);

    expect(() => accumulateChatCompletion([unfinished])).toThrow(APIConnectionError);
    expect(() => accumulateChatCompletion([])).toThrow(APIConnectionError);
    expect(() =>
      accumulateChatCompletion([chunk([{ index: 1, delta: { content: 'x' }, finish_reason: 'stop' }])])
    ).toThrow(APIConnectionError);
  });
});

describe('the call strategies', () => {
  const rateLimiter = {} as Strategy.LLM.LlmTokenRateLimiter;
  const tokenizer = {} as Strategy.LLM.LlmTokenizer;
  const newOpenAi = (options?: OpenAiStrategyOptions) =>
    new OpenAiCallStrategy('test-key', rateLimiter, tokenizer, { clientOptions: { maxRetries: 0 }, ...options });
  const newAzure = (options?: OpenAiStrategyOptions) =>
    new AzureOpenAiCallStrategy(
      {
        endpoint: 'https://contoso.openai.azure.com',
        deploymentName: 'prod-chat',
        auth: { type: 'api-key', apiKey: 'k' }
      },
      rateLimiter,
      tokenizer,
      { clientOptions: { maxRetries: 0 }, ...options }
    );
  // Replaces the SDK client's create, like the other call strategy tests
  const mockCreate = (strategy: OpenAiCallStrategy, response: unknown = { id: 'chatcmpl-1' }) => {
    const create = vi.fn().mockResolvedValue(response);
    (strategy as unknown as { openAi: unknown }).openAi = { chat: { completions: { create } } };
    return create;
  };

  let served: ReturnType<typeof fakeFetch>;
  const serve = (name: string) => {
    served = fakeFetch(eventChunks(readSse(name)));
    vi.stubGlobal('fetch', served.fetch);
  };

  beforeEach(() => {
    vi.stubEnv('OPENAI_BASE_URL', '');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('json_schema and strict tools use create without stream', async () => {
    const strategy = newOpenAi();
    const create = mockCreate(strategy);
    const onEvent = vi.fn();
    const requests: OpenAiRequest[] = [
      { ...REQUEST, response_format: { type: 'json_schema', json_schema: { name: 'answer' } } },
      { ...REQUEST, tools: [{ type: 'function', function: { name: 'lookup', strict: true } }] }
    ];

    for (const request of requests) {
      await strategy.generate(request, { onEvent });
      expect(create).toHaveBeenLastCalledWith(request, { signal: undefined });
    }
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('streaming false ignores onEvent', async () => {
    const strategy = newOpenAi({ streaming: false });
    const create = mockCreate(strategy);
    const onEvent = vi.fn();

    await expect(strategy.generate(REQUEST, { onEvent })).resolves.toEqual({ id: 'chatcmpl-1' });

    expect(create).toHaveBeenCalledWith(REQUEST, { signal: undefined });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('streamUsage false omits stream_options, and extractUsedTokens falls back to 500', async () => {
    serve('text');
    const strategy = newOpenAi({ streamUsage: false });

    const response = await strategy.generate<OpenAiRequest, ChatCompletion>(REQUEST, { onEvent: () => {} });

    expect(served.requests[0]?.body).toMatchObject({ stream: true });
    expect(served.requests[0]?.body).not.toHaveProperty('stream_options');
    expect(response.usage).toBeUndefined();
    expect(strategy.extractUsedTokens(response)).toBe(500);
  });

  it('falls back to 500 tokens when the stream ends after the finish, before the usage chunk', async () => {
    served = fakeFetch(eventChunks(readSse('usage-last')).slice(0, 3));
    vi.stubGlobal('fetch', served.fetch);
    const strategy = newOpenAi();

    const response = await strategy.generate<OpenAiRequest, ChatCompletion>(REQUEST, { onEvent: () => {} });

    expect(response.choices[0]?.message.content).toBe('Forty-two.');
    expect(strategy.extractUsedTokens(response)).toBe(500);
  });

  it('counts the streamed usage by default', async () => {
    serve('usage-last');
    const strategy = newOpenAi();

    const response = await strategy.generate<OpenAiRequest, ChatCompletion>(REQUEST, { onEvent: () => {} });

    expect(served.requests[0]?.body).toMatchObject({ stream_options: { include_usage: true } });
    expect(strategy.extractUsedTokens(response)).toBe(235);
  });

  it('clientOptions reach the client', () => {
    const clientOptions = { timeout: 1234, maxRetries: 1 };

    expect(newOpenAi({ clientOptions })['openAi']).toMatchObject(clientOptions);
    expect(newAzure({ clientOptions })['client']).toMatchObject(clientOptions);
  });

  it('passes the signal', async () => {
    const { signal } = new AbortController();
    const strategy = newOpenAi();
    const create = mockCreate(strategy, (async function* () {})());

    await expect(strategy.generate(REQUEST, { signal, onEvent: () => {} })).rejects.toThrow(APIConnectionError);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ stream: true }), { signal });
  });

  it('rejects with the SDK error when the stream fails', async () => {
    serve('mid-stream-error');

    await expect(newOpenAi().generate(REQUEST, { onEvent: () => {} })).rejects.toBeInstanceOf(APIError);
  });

  it('azure generate streams', async () => {
    serve('azure-prompt-filter');
    const events: Strategy.LLM.LlmStreamEvent[] = [];

    const response = await newAzure().generate(REQUEST, { onEvent: (event) => void events.push(event) });

    expect(response).toEqual(readProjection('azure-prompt-filter'));
    expect(textOf(events)).toBe('Hi there.');
    expect(served.requests[0]?.url).toContain('/openai/deployments/prod-chat/chat/completions');
    expect(served.requests[0]?.body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it('azure json_schema requests are not streamed', async () => {
    const strategy = newAzure();
    const create = vi.fn().mockResolvedValue({ id: 'chatcmpl-1' });
    (strategy as unknown as { client: unknown }).client = { chat: { completions: { create } } };
    const request: OpenAiRequest = {
      ...REQUEST,
      response_format: { type: 'json_schema', json_schema: { name: 'answer' } }
    };

    await strategy.generate(request, { onEvent: () => {} });

    expect(create).toHaveBeenCalledWith(request, { signal: undefined });
  });

  it('azure rejects with the SDK error when the stream fails', async () => {
    serve('mid-stream-error');

    await expect(newAzure().generate(REQUEST, { onEvent: () => {} })).rejects.toBeInstanceOf(APIError);
  });
});
