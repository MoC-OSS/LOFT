import { APIConnectionError } from 'openai';
import type {
  ChatCompletion,
  ChatCompletionAudio,
  ChatCompletionChunk,
  ChatCompletionMessage,
  ChatCompletionMessageToolCall
} from 'openai/resources/chat/completions';

type FinishReason = ChatCompletion.Choice['finish_reason'];
type ChunkDelta = ChatCompletionChunk.Choice.Delta;

interface ToolCallState {
  id: string;
  type: 'function' | 'custom';
  name: string;
  // The function arguments, or the input of a custom tool
  input: string;
}

interface ChoiceState {
  content: string | null;
  refusal: string | null;
  finishReason: FinishReason | null;
  logprobs: ChatCompletion.Choice.Logprobs | null;
  toolCalls: Map<number, ToolCallState>;
  functionCall?: { name: string; arguments: string };
  audio?: Partial<ChatCompletionAudio>;
  // Fields the provider adds to a choice, such as Azure's content_filter_results
  extras: Record<string, unknown>;
  // Delta fields the accumulator does not map, such as the url_citation annotations of the search models
  messageExtras: Record<string, unknown>;
}

// Chunk fields the accumulator maps itself; every other field is a provider extra and is kept
const CHUNK_FIELDS = new Set([
  'id',
  'object',
  'created',
  'model',
  'system_fingerprint',
  'service_tier',
  'choices',
  'usage',
  'obfuscation'
]);
const CHOICE_FIELDS = new Set(['index', 'delta', 'finish_reason', 'logprobs']);
const DELTA_FIELDS = new Set(['role', 'content', 'refusal', 'tool_calls', 'function_call', 'audio']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Copies the fields of a chunk that the accumulator does not map. An object field is merged into the one before, so
// Azure's per-chunk content filter results add up and a later empty object does not erase them
function mergeExtras(target: Record<string, unknown>, value: object, known: Set<string>): void {
  for (const [key, field] of Object.entries(value) as [string, unknown][]) {
    if (known.has(key)) continue;
    const previous = target[key];
    target[key] = isRecord(previous) && isRecord(field) ? { ...previous, ...field } : field;
  }
}

// Copies the delta fields the accumulator does not map onto the message: lists and strings are concatenated
// (annotations arrive a few at a time, text fields of compatible endpoints in fragments), every other value replaces
// the one before, and an empty value changes nothing
function mergeDeltaExtras(target: Record<string, unknown>, delta: object): void {
  for (const [key, field] of Object.entries(delta) as [string, unknown][]) {
    if (DELTA_FIELDS.has(key) || field === null || field === undefined) continue;
    const previous = target[key];
    if (Array.isArray(previous) && Array.isArray(field)) target[key] = [...previous, ...field];
    else if (typeof previous === 'string' && typeof field === 'string') target[key] = previous + field;
    else target[key] = field;
  }
}

function append(text: string | null, delta: string | null | undefined): string | null {
  return typeof delta === 'string' ? (text ?? '') + delta : text;
}

// Appends the logprobs of one chunk to the list so far, in place, so a long stream is not copied once per chunk. The
// list stays null until a chunk sends one, even an empty one.
function extend<T>(list: T[] | null, next: T[] | null | undefined): T[] | null {
  if (!next) return list;
  if (!list) return [...next];
  for (const item of next) list.push(item);
  return list;
}

// Adds one tool call delta to the call at its index: the id, type and name arrive once, the input in fragments
function addToolCallDelta(
  toolCalls: Map<number, ToolCallState>,
  delta: NonNullable<ChunkDelta['tool_calls']>[number]
): void {
  let toolCall = toolCalls.get(delta.index);
  if (!toolCall) {
    toolCall = { id: '', type: 'function', name: '', input: '' };
    toolCalls.set(delta.index, toolCall);
  }
  if (delta.id) toolCall.id = delta.id;
  if (delta.type === 'custom' || delta.custom) toolCall.type = 'custom';
  const name = delta.function?.name ?? delta.custom?.name;
  if (name) toolCall.name = name;
  toolCall.input += delta.function?.arguments ?? delta.custom?.input ?? '';
}

// Adds an audio delta: the id and the expiry arrive once, the data and the transcript in fragments
function addAudioDelta(audio: Partial<ChatCompletionAudio>, delta: NonNullable<ChunkDelta['audio']>): void {
  const { id, data, transcript, expires_at: expiresAt } = delta;
  if (id) audio.id = id;
  if (expiresAt !== undefined) audio.expires_at = expiresAt;
  if (data) audio.data = (audio.data ?? '') + data;
  if (transcript) audio.transcript = (audio.transcript ?? '') + transcript;
}

function toolCallOf({ id, type, name, input }: ToolCallState): ChatCompletionMessageToolCall {
  return type === 'custom'
    ? { id, type, custom: { name, input } }
    : { id, type: 'function', function: { name, arguments: input } };
}

/**
 * Builds the `ChatCompletion` a non-streamed request returns from the chunks of a streamed one, one chunk at a time.
 */
export class ChatCompletionAccumulator {
  private id = '';
  private created = 0;
  private model = '';
  private systemFingerprint?: string;
  private serviceTier?: ChatCompletion['service_tier'];
  private usage?: ChatCompletion['usage'];
  private readonly extras: Record<string, unknown> = {};
  private readonly choices = new Map<number, ChoiceState>();

  /** @param choiceCount The number of choices the request asked for (`n`); the completion needs every one of them. */
  constructor(private readonly choiceCount = 1) {}

  add(chunk: ChatCompletionChunk): void {
    // Azure's first chunk carries only the prompt filter results, with an empty id and model
    if (chunk.id) {
      this.id = chunk.id;
      this.created = chunk.created;
      this.model = chunk.model;
      if (chunk.system_fingerprint !== undefined) this.systemFingerprint = chunk.system_fingerprint;
      if (chunk.service_tier !== undefined) this.serviceTier = chunk.service_tier;
    }
    if (chunk.usage) this.usage = chunk.usage;
    mergeExtras(this.extras, chunk, CHUNK_FIELDS);

    for (const chunkChoice of chunk.choices) {
      const choice = this.choice(chunkChoice.index);
      if (chunkChoice.finish_reason) choice.finishReason = chunkChoice.finish_reason;
      if (chunkChoice.logprobs) {
        choice.logprobs ??= { content: null, refusal: null };
        choice.logprobs.content = extend(choice.logprobs.content, chunkChoice.logprobs.content);
        choice.logprobs.refusal = extend(choice.logprobs.refusal, chunkChoice.logprobs.refusal);
      }
      mergeExtras(choice.extras, chunkChoice, CHOICE_FIELDS);
      if (chunkChoice.delta) this.addDelta(choice, chunkChoice.delta);
    }
  }

  /** The finish reason of the first choice, once it is known. */
  get firstFinishReason(): FinishReason | undefined {
    return this.choices.get(0)?.finishReason ?? undefined;
  }

  get modelName(): string {
    return this.model;
  }

  /** Whether every choice the request asked for has its finish reason, so `result()` returns. */
  get finished(): boolean {
    for (let index = 0; index < this.expectedChoices; index++) {
      if (!this.choices.get(index)?.finishReason) return false;
    }
    return true;
  }

  /**
   * The completion so far. Throws when a choice is missing or unfinished, as happens when the stream ends early.
   */
  result(): ChatCompletion {
    const choices: ChatCompletion.Choice[] = [];
    for (let index = 0; index < this.expectedChoices; index++) {
      const choice = this.choices.get(index);
      if (!choice?.finishReason) {
        throw new APIConnectionError({ message: `The stream ended before choice ${index} finished` });
      }
      choices.push({
        ...choice.extras,
        index,
        finish_reason: choice.finishReason,
        // A copy, so a later chunk cannot change a completion already returned
        logprobs: choice.logprobs && {
          content: choice.logprobs.content && [...choice.logprobs.content],
          refusal: choice.logprobs.refusal && [...choice.logprobs.refusal]
        },
        message: this.message(choice)
      });
    }

    return {
      ...this.extras,
      id: this.id,
      object: 'chat.completion',
      created: this.created,
      model: this.model,
      choices,
      ...(this.systemFingerprint !== undefined && { system_fingerprint: this.systemFingerprint }),
      ...(this.serviceTier !== undefined && { service_tier: this.serviceTier }),
      ...(this.usage && { usage: this.usage })
    };
  }

  // The choices the completion needs: the ones asked for, and any other the stream sent
  private get expectedChoices(): number {
    return Math.max(this.choices.size, this.choiceCount, 1);
  }

  private choice(index: number): ChoiceState {
    let choice = this.choices.get(index);
    if (!choice) {
      choice = {
        content: null,
        refusal: null,
        finishReason: null,
        logprobs: null,
        toolCalls: new Map(),
        extras: {},
        messageExtras: {}
      };
      this.choices.set(index, choice);
    }
    return choice;
  }

  private addDelta(choice: ChoiceState, delta: ChunkDelta): void {
    choice.content = append(choice.content, delta.content);
    choice.refusal = append(choice.refusal, delta.refusal);
    mergeDeltaExtras(choice.messageExtras, delta);

    for (const toolCallDelta of delta.tool_calls ?? []) addToolCallDelta(choice.toolCalls, toolCallDelta);

    if (delta.function_call) {
      choice.functionCall ??= { name: '', arguments: '' };
      if (delta.function_call.name) choice.functionCall.name = delta.function_call.name;
      choice.functionCall.arguments += delta.function_call.arguments ?? '';
    }

    if (delta.audio) {
      choice.audio ??= {};
      addAudioDelta(choice.audio, delta.audio);
    }
  }

  private message(choice: ChoiceState): ChatCompletionMessage {
    const toolCalls = [...choice.toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => toolCallOf(call));
    return {
      ...choice.messageExtras,
      role: 'assistant',
      content: choice.content,
      refusal: choice.refusal,
      ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      ...(choice.functionCall && { function_call: choice.functionCall }),
      ...(choice.audio && {
        audio: {
          id: choice.audio.id ?? '',
          data: choice.audio.data ?? '',
          expires_at: choice.audio.expires_at ?? 0,
          transcript: choice.audio.transcript ?? ''
        }
      })
    };
  }
}

/**
 * Builds the `ChatCompletion` a non-streamed request returns from the chunks of a streamed one.
 * - Per choice: content, refusal, tool calls merged by their index, the finish reason and logprobs.
 * - `id`, `model`, `created`, `system_fingerprint` and `service_tier` from the last chunk with an id (Azure's first
 *   chunk has none), and usage from the last chunk that has it.
 * - Provider extras, such as Azure's `prompt_filter_results` and `content_filter_results`, are kept, and delta fields
 *   it does not map, such as `annotations`, are kept on the message.
 */
export function accumulateChatCompletion(chunks: Iterable<ChatCompletionChunk>): ChatCompletion {
  const accumulator = new ChatCompletionAccumulator();
  for (const chunk of chunks) accumulator.add(chunk);
  return accumulator.result();
}
