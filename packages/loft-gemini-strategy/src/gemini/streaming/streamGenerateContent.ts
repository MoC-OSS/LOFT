import type { GenerateContentResponse, Part } from '@google/genai';
import { guardedStreamSink, Logger, providerErrorSummary, Strategy } from '@moc-global/loft-definitions';

import type { GeminiRequest } from '../../VertexAiTypes';
import { geminiUsageToUnified } from '../adapters/usage';
import { cutStreamError, GenerateContentAccumulator } from './accumulateGenerateContent';

const log = new Logger('GeminiStrategy');

/** Opens a streamed request, e.g. `() => ai.models.generateContentStream(params)`. */
export type OpenGenerateContentStream = () => Promise<AsyncGenerator<GenerateContentResponse>>;

export interface StreamGenerateContentOptions {
  /** The signal the request was sent with, as `config.abortSignal`. */
  signal?: AbortSignal;
  onEvent: Strategy.LLM.LlmStreamSink;
  /** The number of candidates the request asked for (`config.candidateCount`), 1 by default. */
  candidateCount?: number;
}

/**
 * False when the request asks for more than one candidate, which Vertex AI rejects on a streamed request. Such requests
 * are sent without streaming.
 */
export function isStreamable(request: GeminiRequest): boolean {
  return (request.config?.candidateCount ?? 1) <= 1;
}

// True when a part carries anything besides empty text and the thought flag
function hasPayload(part: Part): boolean {
  return (Object.entries(part) as [string, unknown][]).some(
    ([key, value]) => key !== 'thought' && value !== undefined && value !== null && value !== ''
  );
}

// What one chunk shows: the first candidate's text and thoughts, an activity for each other part, and the usage
function* eventsOf(
  chunk: GenerateContentResponse,
  accumulator: GenerateContentAccumulator
): Generator<Strategy.LLM.LlmStreamEvent> {
  for (const [position, candidate] of (chunk.candidates ?? []).entries()) {
    const first = (candidate.index ?? position) === 0;
    for (const part of candidate.content?.parts ?? []) {
      if (first && typeof part.text === 'string' && part.text) {
        yield part.thought ? { type: 'reasoning-delta', delta: part.text } : { type: 'text-delta', delta: part.text };
      } else if (hasPayload(part)) {
        yield { type: 'activity' };
      }
    }
  }
  if (chunk.usageMetadata) {
    yield {
      type: 'usage',
      usage: geminiUsageToUnified(
        chunk.usageMetadata,
        chunk.modelVersion || accumulator.modelVersion,
        accumulator.firstFinishReason
      )
    };
  }
}

// What the SDK rejects a non-streamed request with when its signal aborts (the request's own controller aborts
// without a reason)
const abortError = () => new DOMException('This operation was aborted', 'AbortError');

// The plain `Error` the SDK throws when the body ends inside an event. It also throws it for an error object that
// arrives split across network reads: the SDK only recognises an error object that a single read holds whole (an SDK
// bug), so the error's own status is lost there
const isIncompleteEvent = (error: unknown): boolean =>
  error instanceof Error && error.message === 'Incomplete JSON segment at the end';

/**
 * Reads a streamed request and resolves with the `GenerateContentResponse` the same request returns without
 * streaming. While the chunks arrive, `onEvent` receives the first candidate's text as `text-delta` and its thought
 * summaries as `reasoning-delta`, an `activity` for every other part (function calls, code, inline data, other
 * candidates, a lone thought signature), and each `usageMetadata` as `usage`. Gemini repeats the usage on many chunks
 * as a running total, so each `usage` event replaces the one before; they must not be added up. A mid-stream error
 * rejects with the SDK's error. A stream that ends before every candidate finished, or inside an event, rejects with a
 * retryable 502 `ApiError`, with the SDK's error, if any, as its `cause`.
 */
export async function streamGenerateContent(
  stream: OpenGenerateContentStream,
  { signal, onEvent, candidateCount }: StreamGenerateContentOptions
): Promise<GenerateContentResponse> {
  const chunks = await stream();

  const accumulator = new GenerateContentAccumulator(candidateCount ?? 1);
  // The sink must not throw; if it does, the reply is still built
  const emit = guardedStreamSink(onEvent, (message) => log.warn(message));
  try {
    for await (const chunk of chunks) {
      accumulator.add(chunk);
      for (const event of eventsOf(chunk, accumulator)) emit(event);
    }
  } catch (error) {
    // Only a body that ends inside an event is a stream cut short; every other error, the API's error objects among
    // them, rejects as it is
    if (!isIncompleteEvent(error)) throw error;
    if (signal?.aborted) throw abortError();
    // Once every candidate has finished, only the tail was lost, so the reply stands
    if (accumulator.finished) return accumulator.result();
    throw cutStreamError(error);
  }
  // An abort after the last chunk ends the loop without an error; reject as a non-streamed request does
  if (signal?.aborted) throw abortError();
  return accumulator.result();
}

/** `streamGenerateContent`, with a log of the failure that leaves out the provider's text. */
export async function generateStreamed(
  stream: OpenGenerateContentStream,
  options: StreamGenerateContentOptions
): Promise<GenerateContentResponse> {
  try {
    return await streamGenerateContent(stream, options);
  } catch (error) {
    log.error('streamed generate failed', providerErrorSummary(error));
    throw error;
  }
}
