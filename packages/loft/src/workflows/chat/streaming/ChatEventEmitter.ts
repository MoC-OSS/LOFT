import { randomUUID } from 'node:crypto';

import { Chat, Logger, Strategy } from '@moc-global/loft-definitions';

import { normalizeFinishReason } from './finishReason';
import { isObserveOnly, ResolvedStreamOptions, resolveStreamOptions } from './resolveStreamOptions';
import { toStreamError } from './streamErrors';

// An event as the emitter builds it, per member of the union; seq and runId are added when it is sent
type WithoutBase<T> = T extends unknown ? Omit<T, keyof Chat.ChatStreamEventBase> : never;
type EventBody = WithoutBase<Chat.ChatStreamEvent>;

interface StepState {
  // status generating was sent for this step
  generating: boolean;
  // The text deltas sent in this step, provider or fallback
  text: string;
  // At least one text delta came from the provider
  streamed: boolean;
  // A tool call was reported in this step, also when tool calls are not sent
  hadToolCalls: boolean;
  firstOutputAt?: Date;
  finished: boolean;
}

// Middleware lists already warned about, so a warning is logged once per list and not on every call
const warnedMiddleware = new Set<string>();

/**
 * Turns LlmManager's reports of one generate() call into the caller's events. It keeps the order (step-start,
 * statuses, deltas, tool events, step-finish), applies the text and include options, sends exactly one terminal
 * event, and drops everything after it. It never logs payloads: no deltas, arguments, data or error text.
 */
export class ChatEventEmitter implements Chat.GenerationEventSink {
  private options: ResolvedStreamOptions = resolveStreamOptions();
  private readonly steps = new Map<number, StepState>();
  // The tool calls that finished, by step and call id: a later step may reuse an id
  private readonly finishedTools = new Set<string>();
  private readonly usages: Strategy.LLM.StreamUsage[] = [];
  private seq = 0;
  private nextStep = 0;
  private lastFinishedStep?: number;
  private synthetic = false;
  private loopLimit = false;
  private isStarted = false;
  private isFinished = false;
  private readonly runId: string;
  /** The streaming options the caller passed for this call, before they are merged over the chat config */
  readonly streamOptions?: Chat.StreamOptions;

  constructor(
    private readonly onEvent: (event: Chat.ChatStreamEvent) => void,
    private readonly log: Logger,
    { runId = randomUUID(), streamOptions }: { runId?: string; streamOptions?: Chat.StreamOptions } = {}
  ) {
    this.runId = runId;
    this.streamOptions = streamOptions;
  }

  get started(): boolean {
    return this.isStarted;
  }

  /** True once a terminal event (finish, error or abort) was sent */
  get finished(): boolean {
    return this.isFinished;
  }

  /** Sets the options of this call; called before start. */
  configure(options: ResolvedStreamOptions, outputMiddleware: string[]): void {
    if (this.isStarted) return;
    this.options = options;

    if (options.policyDefaulted && options.textPolicy === 'after-middleware') {
      const key = [...outputMiddleware].sort((a, b) => a.localeCompare(b)).join('\n');
      if (!warnedMiddleware.has(key)) {
        warnedMiddleware.add(key);
        this.log.warn(
          `Streamed text is held until the end of generation, because output middleware is registered: ${outputMiddleware.join(', ')}. ` +
            "To stream text as it arrives, set the text policy to 'all' or register the middleware with transformsOutput: false, " +
            'but only when the middleware need not change what the user sees, such as by redaction: streamed text is sent unchanged.'
        );
      }
    }
  }

  start(sessionId: string): void {
    if (this.isStarted) return;
    this.isStarted = true;
    this.send({
      type: 'start',
      sessionId,
      textPolicy: this.options.textPolicy,
      streaming: !isObserveOnly(this.options)
    });
  }

  stepStart(): number {
    const step = this.nextStep++;
    if (!this.isOpen()) return step;

    this.steps.set(step, { generating: false, text: '', streamed: false, hadToolCalls: false, finished: false });
    this.send({ type: 'step-start', step });
    this.send({ type: 'status', step, phase: 'queued' });
    return step;
  }

  provider(step: number): Strategy.LLM.LlmStreamSink | undefined {
    // Before start no event can be sent, as when a `callAndHandle` override never starts the events, so the provider
    // call is made without streaming
    if (!this.isStarted || isObserveOnly(this.options)) return undefined;

    return (event) => {
      const state = this.openStep(step);
      if (!state) return false;

      switch (event.type) {
        case 'request-start':
          // A new attempt: its output, not a failed attempt's, is the step's first output
          state.firstOutputAt = undefined;
          this.send({ type: 'status', step, phase: 'generating' });
          state.generating = true;
          return false;
        case 'text-delta':
          state.firstOutputAt ??= new Date();
          if (this.options.textPolicy !== 'all' || !event.delta) return false;
          this.ensureGenerating(step, state);
          this.send({ type: 'text-delta', step, delta: event.delta });
          state.text += event.delta;
          state.streamed = true;
          return true;
        case 'reasoning-delta':
          state.firstOutputAt ??= new Date();
          if (!this.options.reasoning || !event.delta) return false;
          this.ensureGenerating(step, state);
          this.send({ type: 'reasoning-delta', step, delta: event.delta });
          return true;
        case 'activity':
          state.firstOutputAt ??= new Date();
          return false;
        default:
          return false;
      }
    };
  }

  stepText(step: number, text: string): void {
    const state = this.openStep(step);
    if (!state) return;
    this.ensureGenerating(step, state);

    // A synthetic response's text, and all text under 'after-middleware', is sent by finish
    if (this.synthetic || this.options.textPolicy !== 'all') return;
    // The provider did not stream the step's text (it cannot stream, or the call only observes)
    if (state.text || !text) return;
    this.send({ type: 'text-delta', step, delta: text });
    state.text = text;
  }

  toolCall(step: number, call: { toolCallId: string; name: string; args: Record<string, unknown> }): void {
    const state = this.openStep(step);
    if (!state) return;
    state.hadToolCalls = true;
    if (this.options.toolCalls === 'none') return;
    this.ensureGenerating(step, state);

    let args: Record<string, unknown> | undefined;
    if (this.options.toolCalls === 'args') {
      // A copy, so a caller that changes it cannot change what the tool receives
      try {
        args = structuredClone(call.args);
      } catch {
        // Arguments that cannot be copied are left out
      }
    }
    this.send({ type: 'tool-call', step, toolCallId: call.toolCallId, name: call.name, ...(args && { args }) });
  }

  data(step: number, tool: { toolCallId: string; toolName: string }, name: string, data: unknown): void {
    const state = this.openStep(step);
    if (!state || this.finishedTools.has(toolKey(step, tool.toolCallId))) return;
    this.ensureGenerating(step, state);
    this.send({ type: 'data', step, toolCallId: tool.toolCallId, toolName: tool.toolName, name, data });
  }

  toolResult(
    step: number,
    result: { toolCallId: string; name: string; status: 'succeeded' | 'failed'; durationMs: number }
  ): void {
    this.finishedTools.add(toolKey(step, result.toolCallId));
    const state = this.openStep(step);
    if (!state || this.options.toolCalls === 'none') return;
    this.ensureGenerating(step, state);
    this.send({ type: 'tool-result', step, ...result });
  }

  stepFinish(
    step: number,
    info: { finishReason: string; hadToolCalls: boolean; usage: Strategy.LLM.StreamUsage }
  ): void {
    const state = this.openStep(step);
    if (!state) return;
    this.ensureGenerating(step, state);

    const usage = toStreamUsage(info.usage);
    this.usages.push(usage);
    this.send({
      type: 'step-finish',
      step,
      reason: normalizeFinishReason(info.finishReason, info.hadToolCalls),
      finishReason: info.finishReason,
      hadToolCalls: info.hadToolCalls,
      streamed: state.streamed,
      usage
    });
    state.finished = true;
    this.lastFinishedStep = step;
  }

  markSynthetic(): void {
    this.synthetic = true;
  }

  loopLimitReached(): void {
    this.loopLimit = true;
  }

  firstOutputAt(step: number): Date | undefined {
    return this.steps.get(step)?.firstOutputAt;
  }

  /**
   * Sends the final text and ends the call. Under 'after-middleware', for a synthetic response, or when no step ran,
   * the text is first sent in one extra step of its own. The loop limit ends with empty text. A step that is still
   * open is closed first, so steps never interleave.
   */
  finish(input: { finishReason: string; text: string }): void {
    if (!this.isOpen()) return;

    const finishReason = this.loopLimit ? Strategy.LLM.LoftFinishReason.MAX_LOOPS_EXCEEDED : input.finishReason;
    const text = this.loopLimit ? '' : input.text;
    this.closeOpenSteps(finishReason);
    // The reason of the last step that reached the provider, before a step that only carries text is added
    const lastStep = this.lastFinishedStep === undefined ? undefined : this.steps.get(this.lastFinishedStep);
    const reason = normalizeFinishReason(finishReason, lastStep?.hadToolCalls ?? false);

    let textReplaced: boolean;
    if (text && (this.synthetic || this.options.textPolicy === 'after-middleware' || this.steps.size === 0)) {
      this.sendTextStep(text, finishReason);
      textReplaced = false;
    } else {
      const lastText = this.lastFinishedStep === undefined ? '' : (this.steps.get(this.lastFinishedStep)?.text ?? '');
      textReplaced = text !== lastText;
    }

    this.send({ type: 'finish', reason, finishReason, text, textReplaced, usage: totalUsage(this.usages) });
    this.isFinished = true;
  }

  /**
   * Ends the call with abort when the signal was aborted, and with error otherwise. The abort's reason is `timeout`
   * when the signal was aborted by a timeout, such as `AbortSignal.timeout()`. A step that is still open gets no
   * step-finish: it did not finish, and the final event ends it.
   */
  fail(error: unknown, signal?: AbortSignal): void {
    if (!this.isOpen()) return;
    this.send(
      signal?.aborted
        ? { type: 'abort', reason: isTimeoutReason(signal.reason) ? 'timeout' : 'cancelled' }
        : { type: 'error', ...toStreamError(error) }
    );
    this.isFinished = true;
  }

  // Sends step-finish for the steps that never got one; their usage is unknown, so it is left out
  private closeOpenSteps(finishReason: string): void {
    for (const [step, state] of this.steps) {
      if (state.finished) continue;
      this.ensureGenerating(step, state);
      this.send({
        type: 'step-finish',
        step,
        reason: normalizeFinishReason(finishReason, state.hadToolCalls),
        finishReason,
        hadToolCalls: state.hadToolCalls,
        streamed: state.streamed
      });
      state.finished = true;
      this.lastFinishedStep = step;
    }
  }

  private isOpen(): boolean {
    return this.isStarted && !this.isFinished;
  }

  // The state of a step that can still send events
  private openStep(step: number): StepState | undefined {
    if (!this.isOpen()) return undefined;
    const state = this.steps.get(step);
    return state && !state.finished ? state : undefined;
  }

  // status generating comes before the step's first output, also when no attempt reported its start
  private ensureGenerating(step: number, state: StepState): void {
    if (state.generating) return;
    this.send({ type: 'status', step, phase: 'generating' });
    state.generating = true;
  }

  // One step that only carries the final text; it has no usage of its own
  private sendTextStep(text: string, finishReason: string): void {
    const step = this.nextStep++;
    this.steps.set(step, { generating: true, text, streamed: false, hadToolCalls: false, finished: true });
    this.send({ type: 'step-start', step });
    this.send({ type: 'status', step, phase: 'queued' });
    this.send({ type: 'status', step, phase: 'generating' });
    this.send({ type: 'text-delta', step, delta: text });
    this.send({
      type: 'step-finish',
      step,
      reason: normalizeFinishReason(finishReason, false),
      finishReason,
      hadToolCalls: false,
      streamed: false
    });
    this.lastFinishedStep = step;
  }

  // A throwing callback is logged with the event type only, and generation goes on. So is an async one that rejects:
  // its promise is not awaited, and its rejection must not become an unhandled rejection.
  private send(body: EventBody): void {
    const event = { ...body, seq: this.seq++, runId: this.runId } as Chat.ChatStreamEvent;
    const warn = () => this.log.warn('The onEvent callback threw; generation continues', { type: body.type });
    try {
      const returned: unknown = this.onEvent(event);
      if (isThenable(returned)) returned.then(undefined, warn);
    } catch {
      warn();
    }
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

// AbortSignal.timeout() aborts with a DOMException named TimeoutError; an error of that name counts the same
function isTimeoutReason(reason: unknown): boolean {
  return (reason instanceof Error || reason instanceof DOMException) && reason.name === 'TimeoutError';
}

// A tool call is known by its step and its id, since providers may number the calls of each response from the start
function toolKey(step: number, toolCallId: string): string {
  return `${step}:${toolCallId}`;
}

// The usage fields that can be serialised; the start time (a Date) is left out
function toStreamUsage(usage: Strategy.LLM.StreamUsage): Strategy.LLM.StreamUsage {
  const result: Strategy.LLM.StreamUsage = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens
  };
  if (usage.cacheTokens !== undefined) result.cacheTokens = usage.cacheTokens;
  if (usage.reasoningTokens !== undefined) result.reasoningTokens = usage.reasoningTokens;
  if (usage.totalCost !== undefined) result.totalCost = usage.totalCost;
  if (usage.model !== undefined) result.model = usage.model;
  if (usage.finishReason !== undefined) result.finishReason = usage.finishReason;
  return result;
}

type SummedField = 'cacheTokens' | 'reasoningTokens' | 'totalCost';

// The total over the provider calls: tokens and cost summed, model and finish reason from the last call
function totalUsage(usages: Strategy.LLM.StreamUsage[]): Strategy.LLM.StreamUsage {
  const total: Strategy.LLM.StreamUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  for (const usage of usages) {
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    total.totalTokens += usage.totalTokens;
    for (const field of ['cacheTokens', 'reasoningTokens', 'totalCost'] satisfies SummedField[]) {
      const value = usage[field];
      if (value !== undefined) total[field] = (total[field] ?? 0) + value;
    }
  }
  const last = usages.at(-1);
  if (last?.model !== undefined) total.model = last.model;
  if (last?.finishReason !== undefined) total.finishReason = last.finishReason;
  return total;
}
