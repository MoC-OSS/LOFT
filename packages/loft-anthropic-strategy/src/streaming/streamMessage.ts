import Anthropic, { AnthropicError, APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import { Logger, Strategy } from '@moc-global/loft-definitions';

import { anthropicStreamUsage } from '../adapters/usage';

const log = new Logger('AnthropicStrategy');

export interface StreamMessageOptions {
  signal?: AbortSignal;
  onEvent: Strategy.LLM.LlmStreamSink;
}

// What earlier events of the message told: its model and input tokens, for the usage of later events
interface Known {
  model?: string;
  inputTokens?: number;
}

// True when a delta carries anything besides its type, ignoring empty strings
function hasPayload(delta: object): boolean {
  return (Object.entries(delta) as [string, unknown][]).some(
    ([key, value]) => key !== 'type' && value !== null && value !== undefined && value !== ''
  );
}

// What one raw event shows: the text of text blocks, the thinking of thinking blocks, an activity for every other
// non-empty block or delta (tool use and its input, signatures, citations, redacted thinking, server tools), and the
// usage of the message events
function* eventsOf(event: Anthropic.RawMessageStreamEvent, known: Known): Generator<Strategy.LLM.LlmStreamEvent> {
  switch (event.type) {
    case 'message_start': {
      const { model, usage } = event.message;
      known.model = model;
      known.inputTokens = usage?.input_tokens;
      if (usage) yield { type: 'usage', usage: anthropicStreamUsage(usage, known) };
      return;
    }
    case 'message_delta': {
      const { usage, delta } = event;
      if (!usage) return;
      yield { type: 'usage', usage: anthropicStreamUsage(usage, known, delta.stop_reason) };
      if (typeof usage.input_tokens === 'number') known.inputTokens = usage.input_tokens;
      return;
    }
    case 'content_block_start': {
      const block = event.content_block;
      if (block.type === 'text') {
        if (block.text) yield { type: 'text-delta', delta: block.text };
        else if (block.citations?.length) yield { type: 'activity' };
      } else if (block.type === 'thinking') {
        if (block.thinking) yield { type: 'reasoning-delta', delta: block.thinking };
        else if (block.signature) yield { type: 'activity' };
      } else {
        yield { type: 'activity' };
      }
      return;
    }
    case 'content_block_delta': {
      const { delta } = event;
      if (delta.type === 'text_delta') {
        if (delta.text) yield { type: 'text-delta', delta: delta.text };
      } else if (delta.type === 'thinking_delta') {
        if (delta.thinking) yield { type: 'reasoning-delta', delta: delta.thinking };
      } else if (hasPayload(delta)) {
        yield { type: 'activity' };
      }
      return;
    }
    default:
      return;
  }
}

// The SDK's streamed message carries `parsed_output` for structured outputs; the message `create` returns has none
function withoutParsedOutput(message: Anthropic.Message): Anthropic.Message {
  const copy: Anthropic.Message & { parsed_output?: unknown } = { ...message };
  delete copy.parsed_output;
  return copy;
}

/**
 * Sends `body` as a streamed request and resolves with the `Message` the same request returns without streaming.
 * While the events arrive, `onEvent` receives the text of text blocks as `text-delta` and the thinking as
 * `reasoning-delta`, an `activity` for each other non-empty block or delta (tool use and its input JSON, thinking
 * signatures, citations, redacted thinking, server tools), and the counts of `message_start` and `message_delta` as
 * `usage`. A mid-stream error rejects with the SDK's error. A stream that ends before `message_stop` rejects with the
 * SDK's retryable `APIConnectionError`, with the SDK's own error as its `cause`; once `message_stop` arrived, a
 * connection cut short resolves with the message.
 */
export async function streamMessage(
  client: Anthropic,
  body: Anthropic.MessageCreateParamsNonStreaming,
  { signal, onEvent }: StreamMessageOptions
): Promise<Anthropic.Message> {
  const stream = client.messages.stream(body, { signal });

  const known: Known = {};
  let sinkFailed = false;
  let stopped = false;
  // Set once the response arrived. An error before it, such as missing credentials, is not a stream cut short
  let connected = false;
  stream.on('connect', () => {
    connected = true;
  });
  try {
    for await (const event of stream) {
      if (event.type === 'message_stop') stopped = true;
      for (const streamEvent of eventsOf(event, known)) {
        try {
          onEvent(streamEvent);
        } catch {
          // The sink must not throw; if it does, the reply is still built. Only the event type is logged
          if (!sinkFailed) log.warn(`onEvent threw on a ${streamEvent.type} event; later failures are not logged`);
          sinkFailed = true;
        }
      }
    }
    // An abort can end the events without an error; reject as a non-streamed request does
    if (signal?.aborted) throw new APIUserAbortError();
    return withoutParsedOutput(await stream.finalMessage());
  } catch (error) {
    // A body that ends before `message_stop` makes the SDK throw a plain `AnthropicError` ("stream ended without
    // producing a Message", "request ended without sending any chunks", or a partial event's JSON error). It is a
    // connection cut short, so it rejects with the retryable `APIConnectionError`, or with the abort error when the
    // signal aborted. API errors, and errors before the response arrived, reject as they are
    if (!connected || !(error instanceof AnthropicError) || error instanceof APIError) throw error;
    if (signal?.aborted) throw new APIUserAbortError();
    // Once `message_stop` arrived, only the tail was lost, so the reply stands. `finalMessage()` rejects once the
    // stream failed, so the message is read from the messages the stream received
    const message = stopped ? stream.receivedMessages.at(-1) : undefined;
    if (message) return withoutParsedOutput(message);
    throw new APIConnectionError({ message: 'The stream ended before message_stop', cause: error });
  }
}

/**
 * What the log may say about a failed streamed request: the error's class, HTTP status, `type` and `code`. The message
 * and body are left out, as they can quote the provider's output.
 */
export function streamErrorSummary(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return { name: typeof error };
  const { status, type, code } = error as { status?: unknown; type?: unknown; code?: unknown };
  // The SDK's errors keep the name 'Error', so the class name tells them apart
  return { name: (error as { constructor?: { name?: unknown } }).constructor?.name, status, type, code };
}

/** `streamMessage`, with a log of the failure that leaves out the provider's text. */
export async function generateStreamed(
  client: Anthropic,
  body: Anthropic.MessageCreateParamsNonStreaming,
  options: StreamMessageOptions
): Promise<Anthropic.Message> {
  try {
    return await streamMessage(client, body, options);
  } catch (error) {
    log.error('streamed generate failed', streamErrorSummary(error));
    throw error;
  }
}
