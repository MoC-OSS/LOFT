import { Strategy } from '@moc-global/loft-definitions';

import type { ScriptedLLMCall, ScriptedReply, ScriptedResponse, ScriptedTurn } from './ScriptedLLMStrategy';

type TextTurn = Extract<ScriptedTurn, { text: string } | { toolCalls: unknown[] }>;

function hasChunks(turn: ScriptedTurn): turn is TextTurn & { chunks: string[] } {
  return 'chunks' in turn && turn.chunks !== undefined;
}

/** Fails when the chunks of a scripted turn do not add up to its text, so a test cannot stream one text and save another. */
export function assertChunksMatchText(turn: ScriptedTurn): void {
  if (!hasChunks(turn)) return;
  const joined = turn.chunks.join('');
  const text = turn.text ?? '';
  if (joined !== text) {
    throw new Error(`The chunks of a scripted turn must join to its text: chunks give "${joined}", text is "${text}"`);
  }
}

function assertScriptValid(replies: ScriptedReply[]): void {
  for (const reply of replies) {
    if (typeof reply !== 'function') assertChunksMatchText(reply);
  }
}

/** Waits `ms` milliseconds and rejects with the abort reason as soon as the signal aborts. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function hangUntilAborted(signal: AbortSignal | undefined, missingSignalMessage: string): Promise<never> {
  if (!signal) return Promise.reject(new Error(missingSignalMessage));
  return new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/** Sends the chunks of a turn to the sink: the activity events first, then one text-delta per chunk. */
async function streamChunks(turn: TextTurn & { chunks: string[] }, options: Strategy.LLM.CallOptions): Promise<void> {
  const { signal, onEvent } = options;
  if (!onEvent) return;
  const events: Strategy.LLM.LlmStreamEvent[] = [
    ...Array.from({ length: turn.activityChunks ?? 0 }, (): Strategy.LLM.LlmStreamEvent => ({ type: 'activity' })),
    ...turn.chunks.map((delta): Strategy.LLM.LlmStreamEvent => ({ type: 'text-delta', delta }))
  ];
  for (const [index, event] of events.entries()) {
    if (index > 0 && turn.chunkDelayMs) await pause(turn.chunkDelayMs, signal);
    signal?.throwIfAborted();
    onEvent(event);
  }
  signal?.throwIfAborted();
  if (turn.failAfterChunks) throw turn.failAfterChunks;
  if (turn.waitForAbortAfterChunks) {
    await hangUntilAborted(signal, 'A waitForAbortAfterChunks reply needs a generate() call with an AbortSignal');
  }
}

/**
 * The replies of a scripted model and the calls it received. ScriptedLLMStrategy plays them directly, and
 * ScriptedLLMApi plays them behind a call manager.
 */
export class ScriptedTurnPlayer {
  readonly calls: ScriptedLLMCall[] = [];
  private readonly replies: ScriptedReply[];
  private toolCallCount = 0;

  constructor(
    private readonly label: string,
    replies: ScriptedReply[] = []
  ) {
    assertScriptValid(replies);
    this.replies = [...replies];
  }

  script(...replies: ScriptedReply[]): void {
    assertScriptValid(replies);
    this.replies.push(...replies);
  }

  get remainingReplies(): number {
    return this.replies.length;
  }

  async play(call: ScriptedLLMCall, options?: Strategy.LLM.CallOptions): Promise<ScriptedResponse> {
    options?.signal?.throwIfAborted();
    this.calls.push(call);

    const reply = this.replies.shift();
    if (!reply) {
      throw new Error(`${this.label} has no reply for call ${this.calls.length}`);
    }
    const turn = typeof reply === 'function' ? await reply(call) : reply;
    assertChunksMatchText(turn);

    if ('error' in turn) throw turn.error;
    if ('waitForAbort' in turn) {
      await hangUntilAborted(options?.signal, 'A waitForAbort reply needs a generate() call with an AbortSignal');
    }
    if (options?.onEvent && hasChunks(turn)) await streamChunks(turn, options);

    return 'toolCalls' in turn
      ? {
          text: turn.text,
          toolCalls: turn.toolCalls.map((toolCall) => ({
            name: toolCall.name,
            arguments: toolCall.arguments,
            callId: toolCall.callId ?? `${toolCall.name}:::scripted-${++this.toolCallCount}`
          }))
        }
      : { text: 'text' in turn ? turn.text : '', toolCalls: [] };
  }
}
