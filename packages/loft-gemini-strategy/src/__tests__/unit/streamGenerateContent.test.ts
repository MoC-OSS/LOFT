import * as fs from 'node:fs';
import * as path from 'node:path';

import { ApiError, GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { isRetryableError, Logger, Strategy, Type } from '@moc-global/loft-definitions';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeminiCallStrategy } from '../../gemini/GeminiCallStrategy';
import { GeminiLoftStrategy } from '../../gemini/GeminiLoftStrategy';
import { GeminiStrategyOptions } from '../../gemini/GeminiStrategyOptions';
import { accumulateGenerateContent } from '../../gemini/streaming/accumulateGenerateContent';
import {
  generateStreamed,
  isStreamable,
  streamErrorSummary,
  streamGenerateContent
} from '../../gemini/streaming/streamGenerateContent';
import { GeminiRequest } from '../../VertexAiTypes';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/stream');
const FIXTURES = [
  'text',
  'function-call',
  'parallel-function-calls',
  'thinking',
  'usage-last',
  'safety-block',
  'prompt-blocked',
  'two-candidates'
];

interface Fixture {
  chunks: GenerateContentResponse[];
  response: GenerateContentResponse;
}

// The chunks as the SDK yields them, and the response the same request returns without streaming, both as SDK objects
function readFixture(name: string): Fixture {
  const { chunks, response } = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8')) as {
    chunks: object[];
    response: object;
  };
  const toResponse = (value: object) => Object.assign(new GenerateContentResponse(), value);
  return { chunks: chunks.map(toResponse), response: toResponse(response) };
}

// A stream that yields the chunks, then throws `error` if one is given
async function* streamOf(chunks: GenerateContentResponse[], error?: unknown): AsyncGenerator<GenerateContentResponse> {
  for (const chunk of chunks) yield chunk;
  if (error !== undefined) throw error;
}

async function stream(
  name: string,
  options: { sink?: Strategy.LLM.LlmStreamSink; signal?: AbortSignal; error?: unknown } = {}
) {
  const events: Strategy.LLM.LlmStreamEvent[] = [];
  const onEvent: Strategy.LLM.LlmStreamSink = (event) => {
    events.push(event);
    return options.sink?.(event);
  };
  const result = streamGenerateContent(async () => streamOf(readFixture(name).chunks, options.error), {
    signal: options.signal,
    onEvent
  });
  return { result, events };
}

const textOf = (events: Strategy.LLM.LlmStreamEvent[], type: 'text-delta' | 'reasoning-delta' = 'text-delta') =>
  events.map((event) => (event.type === type ? event.delta : '')).join('');

const loftStrategy = new GeminiLoftStrategy({ llmName: 'gemini' }, {} as Strategy.CallManager);
// The unified response without the original response; tool call ids are generated when Gemini sends none, as in the
// fixtures, so they are left out too
const format = (response: GenerateContentResponse) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
  const { originalResponse, ...rest } = loftStrategy.formatToUnifiedLLMResponse(
    [],
    's-1',
    response,
    'gemini',
    'assistant'
  );
  const withoutIds = (message: { content: Type.Entity.FullContentPart[] }) => ({
    ...message,
    content: message.content.map((part) => (part.type === 'tool_call' ? { ...part, callId: 'id' } : part))
  });
  return { ...rest, topChoice: withoutIds(rest.topChoice), choices: rest.choices.map(withoutIds) };
};

describe.each(FIXTURES)('the %s stream', (name) => {
  // The getters warn when there are two candidates or parts besides text
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accumulated response formats to the same unified message as the non-streamed response', async () => {
    const { chunks, response } = readFixture(name);
    const { result } = await stream(name);

    expect(format(await result)).toEqual(format(response));
    expect(format(accumulateGenerateContent(chunks))).toEqual(format(response));
    expect(await result).toEqual(response);
  });

  it('.text and .functionCalls getters work', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { response } = readFixture(name);
    const { result } = await stream(name);
    const streamed = await result;

    expect(streamed).toBeInstanceOf(GenerateContentResponse);
    expect(streamed.text).toBe(response.text);
    expect(streamed.functionCalls).toEqual(response.functionCalls);
  });
});

describe('streamGenerateContent events', () => {
  it('emits only candidate-0 text', async () => {
    const { result, events } = await stream('two-candidates');
    await result;

    expect(textOf(events)).toBe('Red sky');
    // The second candidate's parts are kept back but still show the stream is alive
    expect(events.filter((event) => event.type === 'activity')).toHaveLength(2);
    expect(JSON.stringify(events)).not.toMatch(/Blue|sea/);
  });

  it('thought text becomes reasoning-delta', async () => {
    const { result, events } = await stream('thinking');
    await result;

    expect(textOf(events, 'reasoning-delta')).toBe('**Planning**\nThe user wants a haiku.');
    expect(textOf(events)).toBe('Autumn moon rises.');
  });

  it('function calls become activity, never text', async () => {
    const { result, events } = await stream('parallel-function-calls');
    await result;

    expect(events.map((event) => event.type)).toEqual(['activity', 'activity', 'activity', 'usage']);
    expect(JSON.stringify(events)).not.toMatch(/get_weather|get_time|Kyiv|Lviv/);
  });

  it('thought signatures never leave', async () => {
    for (const name of ['function-call', 'parallel-function-calls', 'thinking']) {
      const { result, events } = await stream(name);
      await result;

      expect(JSON.stringify(events)).not.toMatch(/c2ln/);
    }
    // The lone signature at the end of a thinking reply shows as activity only
    const { result, events } = await stream('thinking');
    await result;
    expect(events.at(-2)).toEqual({ type: 'activity' });
  });

  it('usage event from usageMetadata', async () => {
    const { result, events } = await stream('usage-last');
    await result;

    // The empty final text part and the usage-only chunk add no text or activity
    expect(events).toEqual([
      { type: 'text-delta', delta: 'Forty-two.' },
      {
        type: 'usage',
        usage: {
          inputTokens: 25,
          outputTokens: 4,
          totalTokens: 221,
          reasoningTokens: 192,
          model: 'gemini-2.5-flash',
          finishReason: 'STOP'
        }
      }
    ]);
  });

  it('a safety finish is returned, not thrown, without the text the filter cleared', async () => {
    const { result, events } = await stream('safety-block');
    const response = await result;

    expect(response.candidates?.[0]?.finishReason).toBe('SAFETY');
    // The deltas have already gone out; the reply, like a non-streamed one, has no content, and its empty text is what
    // the chat's finish event reports (with textReplaced)
    expect(textOf(events)).toBe('The recipe begins with');
    expect(response.candidates?.[0]?.content).toBeUndefined();
    expect(format(response).topChoice.content).toEqual([]);
  });

  it.each(['SAFETY', 'RECITATION', 'SPII', 'PROHIBITED_CONTENT'])(
    'a candidate blocked on %s has no content; other finishes keep it',
    (finishReason) => {
      const chunks = (reason: string) => [
        Object.assign(new GenerateContentResponse(), {
          candidates: [{ content: { role: 'model', parts: [{ text: 'Partial' }] } }]
        }),
        Object.assign(new GenerateContentResponse(), { candidates: [{ finishReason: reason }] })
      ];

      expect(accumulateGenerateContent(chunks(finishReason)).candidates).toEqual([{ finishReason }]);
      expect(accumulateGenerateContent(chunks('MAX_TOKENS')).candidates).toEqual([
        { finishReason: 'MAX_TOKENS', content: { role: 'model', parts: [{ text: 'Partial' }] } }
      ]);
    }
  );

  it('a blocked prompt is returned, with its usage', async () => {
    const { result, events } = await stream('prompt-blocked');

    expect((await result).promptFeedback?.blockReason).toBe('PROHIBITED_CONTENT');
    expect(events).toEqual([
      { type: 'usage', usage: { inputTokens: 7, outputTokens: 0, totalTokens: 7, model: 'gemini-2.5-flash' } }
    ]);
  });

  it('executable code and inline data become activity', async () => {
    const chunks = [
      Object.assign(new GenerateContentResponse(), {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: '' },
                { executableCode: { code: 'print(1)', language: 'PYTHON' } },
                { codeExecutionResult: { outcome: 'OUTCOME_OK', output: '1' } },
                { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } }
              ]
            },
            finishReason: 'STOP'
          }
        ]
      })
    ];
    const events: Strategy.LLM.LlmStreamEvent[] = [];

    await streamGenerateContent(async () => streamOf(chunks), { onEvent: (event) => void events.push(event) });

    expect(events).toEqual([{ type: 'activity' }, { type: 'activity' }, { type: 'activity' }]);
  });

  it('mid-stream error rejects with the SDK error', async () => {
    const sdkError = new ApiError({ message: 'got status: UNAVAILABLE', status: 503 });
    const { chunks } = readFixture('text');
    const events: Strategy.LLM.LlmStreamEvent[] = [];

    const result = streamGenerateContent(async () => streamOf(chunks.slice(0, 2), sdkError), {
      onEvent: (event) => void events.push(event)
    });

    await expect(result).rejects.toBe(sdkError);
    expect(textOf(events)).toBe('Hello, world');
  });

  it('a throwing sink does not break the result', async () => {
    const sink = vi.fn(() => {
      throw new Error('consumer failed');
    });
    const { result } = await stream('text', { sink });

    expect((await result).text).toBe('Hello, world!');
    expect(sink).toHaveBeenCalledTimes(6);
  });
});

describe('an unfinished or aborted stream', () => {
  it('rejects with a retryable SDK error when it ends before every candidate finished', async () => {
    const { chunks } = readFixture('text');
    const twoCandidates = readFixture('two-candidates').chunks;
    // The second candidate finishes, the first does not
    const firstUnfinished = [
      twoCandidates[0]!,
      Object.assign(new GenerateContentResponse(), {
        candidates: [{ index: 1, content: { role: 'model', parts: [{ text: ' sea' }] }, finishReason: 'STOP' }]
      })
    ];

    for (const cut of [chunks.slice(0, 2), [], firstUnfinished]) {
      const result = streamGenerateContent(async () => streamOf(cut), { onEvent: () => {} });
      const error = await result.catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        message: 'No HTTP error occurred: the stream ended before the model finished its reply',
        status: 502
      });
      expect(isRetryableError(error)).toBe(true);
    }
  });

  // The plain Error the SDK throws when the body ends inside an event
  const incompleteEvent = () => new Error('Incomplete JSON segment at the end');

  it('rejects with the retryable 502, the SDK error as its cause, when it ends inside an event', async () => {
    const sdkError = incompleteEvent();
    const result = streamGenerateContent(async () => streamOf(readFixture('text').chunks.slice(0, 2), sdkError), {
      onEvent: () => {}
    });

    const error = await result.catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, cause: sdkError });
    expect(isRetryableError(error)).toBe(true);
  });

  it('resolves with the reply when it ends inside an event after every candidate finished', async () => {
    const { result } = await stream('two-candidates', { error: incompleteEvent() });
    const { result: whole } = await stream('two-candidates');

    expect(await result).toEqual(await whole);
  });

  it('still rejects with the API error sent after every candidate finished', async () => {
    const apiError = new ApiError({ message: 'got status: UNAVAILABLE', status: 503 });
    const { result } = await stream('text', { error: apiError });

    await expect(result).rejects.toBe(apiError);
  });

  it('rejects with the abort error when the signal aborted and the body ends inside an event', async () => {
    const controller = new AbortController();
    controller.abort();
    const { result } = await stream('text', { signal: controller.signal, error: incompleteEvent() });

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('with candidateCount 2, rejects when it ends before the second candidate sent anything', async () => {
    const firstOnly = readFixture('text').chunks;
    const streamed = (candidateCount?: number) =>
      streamGenerateContent(async () => streamOf(firstOnly, incompleteEvent()), { onEvent: () => {}, candidateCount });

    const error = await streamed(2).catch((caught: unknown) => caught);
    const cleanClose = await streamGenerateContent(async () => streamOf(firstOnly), {
      onEvent: () => {},
      candidateCount: 2
    }).catch((caught: unknown) => caught);

    for (const cut of [error, cleanClose]) {
      expect(cut).toBeInstanceOf(ApiError);
      expect(cut).toMatchObject({ status: 502 });
      expect(isRetryableError(cut)).toBe(true);
    }
    // Without candidateCount the first candidate is the whole reply
    expect((await streamed()).text).toBe('Hello, world!');
  });

  it('rejects with the abort error when the signal aborts, even after the last chunk', async () => {
    const controller = new AbortController();
    const { result, events } = await stream('text', {
      signal: controller.signal,
      sink: (event) => {
        if (event.type === 'text-delta' && event.delta === '!') controller.abort();
      }
    });

    const error = await result.catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ name: 'AbortError' });
    expect(isRetryableError(error)).toBe(false);
    expect(textOf(events)).toBe('Hello, world!');
  });
});

describe('accumulateGenerateContent', () => {
  const chunk = (parts: object[], finishReason?: string) =>
    Object.assign(new GenerateContentResponse(), {
      candidates: [{ content: { role: 'model', parts }, ...(finishReason && { finishReason }) }]
    });

  it('keeps two signatures on their own parts', () => {
    const response = accumulateGenerateContent([
      chunk([{ text: 'One', thoughtSignature: 'sig-1' }]),
      chunk([{ text: 'Two', thoughtSignature: 'sig-2' }], 'STOP')
    ]);

    expect(response.candidates?.[0]?.content?.parts).toEqual([
      { text: 'One', thoughtSignature: 'sig-1' },
      { text: 'Two', thoughtSignature: 'sig-2' }
    ]);
  });

  it('joins text after a part with a signature, keeping the signature', () => {
    const response = accumulateGenerateContent([
      chunk([{ text: 'One', thoughtSignature: 'sig-1' }]),
      chunk([{ text: ' two' }], 'STOP')
    ]);

    expect(response.candidates?.[0]?.content?.parts).toEqual([{ text: 'One two', thoughtSignature: 'sig-1' }]);
  });

  it('keeps the empty text part of a reply that has no other part', () => {
    const response = accumulateGenerateContent([chunk([{ text: '' }]), chunk([{ text: '' }], 'STOP')]);

    expect(response.candidates?.[0]?.content?.parts).toEqual([{ text: '' }]);
    expect(response.text).toBe('');
  });

  it('replaces a first empty text part with the part after it', () => {
    const thought = { text: 'Planning', thought: true };
    const response = accumulateGenerateContent([chunk([{ text: '' }, thought]), chunk([{ text: 'Done' }], 'STOP')]);

    expect(response.candidates?.[0]?.content?.parts).toEqual([thought, { text: 'Done' }]);
  });

  it('drops an empty text part without a signature, and keeps one with a signature', () => {
    const call = { functionCall: { name: 'lookup', args: {} } };
    const signed = { text: '', thoughtSignature: 'sig-1' };
    const response = accumulateGenerateContent([
      chunk([call]),
      chunk([{ text: '' }, { text: '', thought: true }]),
      chunk([call]),
      chunk([signed], 'STOP')
    ]);

    expect(response.candidates?.[0]?.content?.parts).toEqual([call, call, signed]);
  });

  it('keeps the id Gemini gives each function call', () => {
    const calls = [
      { functionCall: { id: 'fc-1', name: 'lookup', args: { q: 'a' } } },
      { functionCall: { id: 'fc-2', name: 'lookup', args: { q: 'b' } } }
    ];
    const response = accumulateGenerateContent([chunk([calls[0]]), chunk([calls[1]], 'STOP')]);

    expect(response.candidates?.[0]?.content?.parts).toEqual(calls);
  });

  it('does not join text across another part', () => {
    const call = { functionCall: { name: 'lookup', args: {} } };
    const response = accumulateGenerateContent([chunk([{ text: 'Before' }, call]), chunk([{ text: 'After' }], 'STOP')]);

    expect(response.candidates?.[0]?.content?.parts).toEqual([{ text: 'Before' }, call, { text: 'After' }]);
  });

  it('keeps the first prompt feedback and the last usage and metadata', () => {
    const response = accumulateGenerateContent([
      Object.assign(new GenerateContentResponse(), {
        promptFeedback: { safetyRatings: [] },
        usageMetadata: { promptTokenCount: 1, totalTokenCount: 1 },
        responseId: 'first'
      }),
      Object.assign(chunk([{ text: 'Hi' }], 'STOP'), {
        promptFeedback: { blockReason: 'OTHER' },
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        responseId: 'last'
      })
    ]);

    expect(response).toMatchObject({
      promptFeedback: { safetyRatings: [] },
      usageMetadata: { totalTokenCount: 2 },
      responseId: 'last'
    });
  });
});

describe('streamed failures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('summarises an error by its class, status, type and code, as the other providers do', () => {
    const renamed = Object.assign(new ApiError({ message: 'secret', status: 503 }), {
      name: 'Renamed',
      type: 'server_error',
      code: 'UNAVAILABLE'
    });

    expect(streamErrorSummary(renamed)).toEqual({
      name: 'ApiError',
      status: 503,
      type: 'server_error',
      code: 'UNAVAILABLE'
    });
  });

  it('logs the name, status and code of the error, never its message', async () => {
    const logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const sdkError = new ApiError({ message: 'got status: 500. {"error":{"message":"Partial secret"}}', status: 500 });

    await expect(generateStreamed(async () => streamOf([], sdkError), { onEvent: () => {} })).rejects.toBe(sdkError);

    expect(logError).toHaveBeenCalledWith('streamed generate failed', {
      name: 'ApiError',
      status: 500,
      code: undefined
    });
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/Partial secret/);
  });

  it('summarises values that are not objects by their type, and nameless errors by their class', () => {
    expect(streamErrorSummary('boom')).toEqual({ name: 'string' });
    expect(streamErrorSummary(undefined)).toEqual({ name: 'undefined' });
    expect(streamErrorSummary(Object.create({ constructor: { name: 'Custom' } }) as object)).toEqual({
      name: 'Custom',
      status: undefined,
      code: undefined
    });
  });
});

describe('the call strategy', () => {
  const REQUEST: GeminiRequest = {
    model: 'gemini-test',
    contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    systemInstruction: { role: 'user', parts: [{ text: 'be brief' }] },
    config: { temperature: 0.2 }
  };

  // Replaces the SDK client's models with fakes that record their params
  function newStrategy(options?: GeminiStrategyOptions) {
    const strategy = new GeminiCallStrategy(
      { mode: 'apikey', apiKey: 'test-key' },
      {} as Strategy.LLM.LlmTokenRateLimiter,
      {} as Strategy.LLM.LlmTokenizer,
      options
    );
    const generateContent = vi.fn(async (_params: GenerateContentParameters) => readFixture('text').response);
    const generateContentStream = vi.fn(async (_params: GenerateContentParameters) =>
      streamOf(readFixture('text').chunks)
    );
    (strategy as unknown as { ai: unknown }).ai = { models: { generateContent, generateContentStream } };
    return { strategy, generateContent, generateContentStream };
  }

  it('passes the abort signal', async () => {
    const { strategy, generateContentStream } = newStrategy();
    const { signal } = new AbortController();

    await strategy.generate(REQUEST, { signal, onEvent: () => {} });

    expect(generateContentStream).toHaveBeenCalledWith({
      model: 'gemini-test',
      contents: REQUEST.contents,
      config: { systemInstruction: REQUEST.systemInstruction, temperature: 0.2, abortSignal: signal }
    });
  });

  it('streams when LOFT passes onEvent, and resolves with the response', async () => {
    const { strategy, generateContent } = newStrategy();
    const events: Strategy.LLM.LlmStreamEvent[] = [];

    const response = await strategy.generate<GeminiRequest, GenerateContentResponse>(REQUEST, {
      onEvent: (event) => void events.push(event)
    });

    expect(response).toEqual(readFixture('text').response);
    expect(strategy.extractUsedTokens(response)).toBe(12);
    expect(textOf(events)).toBe('Hello, world!');
    expect(events.some((event) => event.type === 'request-start')).toBe(false);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('sends a request for more than one candidate without streaming, as Vertex AI rejects it streamed', async () => {
    const { strategy, generateContent, generateContentStream } = newStrategy();
    const onEvent = vi.fn();
    const request = { ...REQUEST, config: { ...REQUEST.config, candidateCount: 2 } };

    await expect(strategy.generate(request, { onEvent })).resolves.toEqual(readFixture('text').response);

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ candidateCount: 2 }) })
    );
    expect(generateContentStream).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('streams a request for one candidate, passing its candidateCount to the stream', async () => {
    const { strategy, generateContent, generateContentStream } = newStrategy();
    const request = { ...REQUEST, config: { ...REQUEST.config, candidateCount: 1 } };

    await expect(strategy.generate(request, { onEvent: () => {} })).resolves.toEqual(readFixture('text').response);

    expect(generateContentStream).toHaveBeenCalledTimes(1);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('isStreamable is false only for more than one candidate', () => {
    const withCount = (candidateCount?: number): GeminiRequest => ({ ...REQUEST, config: { candidateCount } });

    expect([withCount(), withCount(1), withCount(2), { ...REQUEST, config: undefined }].map(isStreamable)).toEqual([
      true,
      true,
      false,
      true
    ]);
  });

  it('streaming false ignores onEvent', async () => {
    const { strategy, generateContent, generateContentStream } = newStrategy({ streaming: false });
    const onEvent = vi.fn();

    await expect(strategy.generate(REQUEST, { onEvent })).resolves.toEqual(readFixture('text').response);

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContentStream).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('no onEvent uses generateContent', async () => {
    const { strategy, generateContent, generateContentStream } = newStrategy();

    await strategy.generate(REQUEST);

    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-test' }));
    expect(generateContentStream).not.toHaveBeenCalled();
  });

  it('a failed request is thrown and logged without its message', async () => {
    const logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { strategy, generateContentStream } = newStrategy();
    const sdkError = new ApiError({ message: 'quota text', status: 429 });
    generateContentStream.mockRejectedValueOnce(sdkError);

    await expect(strategy.generate(REQUEST, { onEvent: () => {} })).rejects.toBe(sdkError);

    expect(logError).toHaveBeenCalledWith('streamed generate failed', {
      name: 'ApiError',
      status: 429,
      code: undefined
    });
    logError.mockRestore();
  });
});
