import { Logger, Strategy } from '@moc-global/loft-definitions';
import { APIConnectionError, APIUserAbortError } from 'openai';
import type { ChatCompletionChunk, ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';

import { openAiUsageToUnified } from '../adapters/OpenAiToUnified';
import { OpenAiRequest, OpenAiResponse } from '../OpenAiTypes';
import { ChatCompletionAccumulator } from './accumulateChatCompletion';

const log = new Logger('OpenAIStrategy');

/** Creates a streamed chat completion, e.g. `(body, options) => client.chat.completions.create(body, options)`. */
export type CreateChatCompletionStream = (
  body: ChatCompletionCreateParamsStreaming,
  options: { signal?: AbortSignal }
) => Promise<AsyncIterable<ChatCompletionChunk>>;

export interface StreamChatCompletionOptions {
  signal?: AbortSignal;
  onEvent: Strategy.LLM.LlmStreamSink;
  /** Asks the API to send the usage in a last chunk. */
  includeUsage: boolean;
}

/**
 * False when the streamed result could differ from the non-streamed one: a `json_schema` response format, or a
 * strict tool. Such requests are sent without streaming.
 */
export function isStreamable(body: OpenAiRequest): boolean {
  if (body.response_format?.type === 'json_schema') return false;
  return !(body.tools ?? []).some((tool) => tool.type === 'function' && tool.function.strict);
}

// True when a delta has a field outside `skip`, ignoring empty strings and lists
function hasPayload(delta: object, skip: Set<string>): boolean {
  return (Object.entries(delta) as [string, unknown][]).some(
    ([key, value]) =>
      !skip.has(key) &&
      value !== null &&
      value !== undefined &&
      value !== '' &&
      !(Array.isArray(value) && !value.length)
  );
}

const ROLE_ONLY = new Set(['role']);
const ROLE_AND_TEXT = new Set(['role', 'content', 'refusal']);

// What one chunk shows: the first choice's text, whether it carries anything else, and its usage
function* eventsOf(
  chunk: ChatCompletionChunk,
  accumulator: ChatCompletionAccumulator
): Generator<Strategy.LLM.LlmStreamEvent> {
  let activity = false;
  for (const { index, delta } of chunk.choices) {
    if (!delta) continue;
    if (index === 0) {
      if (delta.content) yield { type: 'text-delta', delta: delta.content };
      if (delta.refusal) yield { type: 'text-delta', delta: delta.refusal };
      activity ||= hasPayload(delta, ROLE_AND_TEXT);
    } else {
      activity ||= hasPayload(delta, ROLE_ONLY);
    }
  }
  if (activity) yield { type: 'activity' };
  if (chunk.usage) {
    yield {
      type: 'usage',
      usage: openAiUsageToUnified(chunk.usage, chunk.model || accumulator.modelName, accumulator.firstFinishReason)
    };
  }
}

/**
 * Sends `body` as a streamed request and resolves with the `ChatCompletion` the same request returns without
 * streaming. While the chunks arrive, `onEvent` receives the first choice's text and refusal as `text-delta`, an
 * `activity` for each chunk that carries anything else (tool calls, other choices), and the final usage as `usage`.
 * A mid-stream error rejects with the SDK's error. A stream that ends before every choice finished, or inside an event,
 * rejects with the SDK's retryable `APIConnectionError`; once every choice has finished, a cut tail resolves with what
 * arrived, without the usage when its chunk was lost.
 */
export async function streamChatCompletion(
  create: CreateChatCompletionStream,
  body: OpenAiRequest,
  { signal, onEvent, includeUsage }: StreamChatCompletionOptions
): Promise<OpenAiResponse> {
  const request: ChatCompletionCreateParamsStreaming = {
    ...body,
    stream: true,
    ...(includeUsage && { stream_options: { ...body.stream_options, include_usage: true } })
  };
  const stream = await create(request, { signal });

  const accumulator = new ChatCompletionAccumulator(body.n ?? 1);
  let sinkFailed = false;
  try {
    for await (const chunk of stream) {
      accumulator.add(chunk);
      for (const event of eventsOf(chunk, accumulator)) {
        try {
          onEvent(event);
        } catch {
          // The sink must not throw; if it does, the reply is still built. Only the event type is logged
          if (!sinkFailed) log.warn(`onEvent threw on a ${event.type} event; later failures are not logged`);
          sinkFailed = true;
        }
      }
    }
  } catch (error) {
    // The SDK fails to parse an event the body cut short (v7 parses the partial event at its end, v4 drops it). Every
    // other error, the API's error events among them, rejects as it is
    if (!(error instanceof SyntaxError)) throw error;
    if (signal?.aborted) throw new APIUserAbortError();
    // Once every choice has finished, only the tail was lost (the [DONE] line, or the usage chunk), so the reply stands
    if (accumulator.finished) return accumulator.result();
    throw new APIConnectionError({ message: 'The stream ended inside an event', cause: error });
  }
  // Both SDKs end the chunks without an error when the signal aborts; reject as a non-streamed request does. The class
  // comes from the `openai` package this strategy imports, the SDK that made the request
  if (signal?.aborted) throw new APIUserAbortError();
  return accumulator.result();
}

/**
 * What the log may say about a failed streamed request: the error's class, HTTP status, `type` and `code`. The message
 * and body are left out, as they can quote the provider's output.
 */
export function streamErrorSummary(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return { name: typeof error };
  const { status, type, code } = error as { status?: unknown; type?: unknown; code?: unknown };
  // The OpenAI SDK's errors keep the name 'Error', so the class name tells them apart
  return { name: (error as { constructor?: { name?: unknown } }).constructor?.name, status, type, code };
}

/** `streamChatCompletion`, with a log of the failure that leaves out the provider's text. */
export async function generateStreamed(
  create: CreateChatCompletionStream,
  body: OpenAiRequest,
  options: StreamChatCompletionOptions
): Promise<OpenAiResponse> {
  try {
    return await streamChatCompletion(create, body, options);
  } catch (error) {
    log.error('streamed generate failed', streamErrorSummary(error));
    throw error;
  }
}
