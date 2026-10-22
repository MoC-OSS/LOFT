import Anthropic, { AnthropicError, APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import { guardedStreamSink, Logger, providerErrorSummary, Strategy } from '@moc-global/loft-definitions';

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

type RawEvent<T extends Anthropic.RawMessageStreamEvent['type']> = Extract<
  Anthropic.RawMessageStreamEvent,
  { type: T }
>;

// What a block shows as it starts: the text of a text block, the thinking of a thinking block, and an activity for a
// text block with only citations, a thinking block with only a signature, and every other block
function blockStartEvent(
  block: RawEvent<'content_block_start'>['content_block']
): Strategy.LLM.LlmStreamEvent | undefined {
  if (block.type === 'text') {
    if (block.text) return { type: 'text-delta', delta: block.text };
    return block.citations?.length ? { type: 'activity' } : undefined;
  }
  if (block.type === 'thinking') {
    if (block.thinking) return { type: 'reasoning-delta', delta: block.thinking };
    return block.signature ? { type: 'activity' } : undefined;
  }
  return { type: 'activity' };
}

// What a delta shows: its text or thinking, or an activity for any other delta that is not empty
function blockDeltaEvent(delta: RawEvent<'content_block_delta'>['delta']): Strategy.LLM.LlmStreamEvent | undefined {
  if (delta.type === 'text_delta') return delta.text ? { type: 'text-delta', delta: delta.text } : undefined;
  if (delta.type === 'thinking_delta') {
    return delta.thinking ? { type: 'reasoning-delta', delta: delta.thinking } : undefined;
  }
  return hasPayload(delta) ? { type: 'activity' } : undefined;
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
      const shown = blockStartEvent(event.content_block);
      if (shown) yield shown;
      return;
    }
    case 'content_block_delta': {
      const shown = blockDeltaEvent(event.delta);
      if (shown) yield shown;
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
  // The sink must not throw; if it does, the reply is still built
  const emit = guardedStreamSink(onEvent, (message) => log.warn(message));
  let stopped = false;
  // Set once the response arrived. An error before it, such as missing credentials, is not a stream cut short
  let connected = false;
  stream.on('connect', () => {
    connected = true;
  });
  try {
    for await (const event of stream) {
      if (event.type === 'message_stop') stopped = true;
      for (const streamEvent of eventsOf(event, known)) emit(streamEvent);
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

/** `streamMessage`, with a log of the failure that leaves out the provider's text. */
export async function generateStreamed(
  client: Anthropic,
  body: Anthropic.MessageCreateParamsNonStreaming,
  options: StreamMessageOptions
): Promise<Anthropic.Message> {
  try {
    return await streamMessage(client, body, options);
  } catch (error) {
    log.error('streamed generate failed', providerErrorSummary(error));
    throw error;
  }
}
