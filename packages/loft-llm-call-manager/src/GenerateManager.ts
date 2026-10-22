import {
  isRetryableError,
  Logger,
  providerErrorSummary,
  retryDelayMs,
  Strategy,
  StreamIdleTimeoutError,
  waitForRetry
} from '@moc-global/loft-definitions';
import PQueue from 'p-queue';

import { TooManyHighPriorityTasksError } from './errors';
import { GenerateConfig } from './types';

const log = new Logger('LlmCallManager');

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;
// The request timeout of the OpenAI and Anthropic SDKs, which covers only the wait for the response headers
const DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS = 600_000;
// The longest delay setTimeout takes; a longer one fires at once
const MAX_TIMEOUT_MS = 2_147_483_647;

// What the attempts of one streamed call have seen so far
interface StreamProgress {
  /** An event reached the consumer, so a new attempt would repeat it. Stays true for the rest of the call. */
  delivered: boolean;
  /** Some attempt of the call got an event from the provider, which has then started to spend tokens */
  providerEventSeen: boolean;
}

function assertTimeout(name: string, field: string, value: number | undefined) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0 || value > MAX_TIMEOUT_MS) {
    throw new RangeError(`${field} of ${name} must be an integer from 0 to ${MAX_TIMEOUT_MS}, got ${value}`);
  }
}

// Matched by name, so the error still matches when an application ends up with two copies of loft-definitions
function isStreamTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'StreamIdleTimeoutError';
}

// An aborted call is not retried, and neither is one that cannot succeed on a new attempt (400, 401, 404). A streamed
// call is not retried once its consumer was shown an event, which a new attempt would repeat.
function canRetry(error: unknown, options: Strategy.LLM.CallOptions | undefined, progress: StreamProgress): boolean {
  if (options?.signal?.aborted || progress.delivered) return false;
  return isRetryableError(error) || (options?.onEvent !== undefined && isStreamTimeout(error));
}

/**
 * The part of p-queue the call managers use. p-queue publishes its types only through `exports`, so declaring
 * the queue type here keeps the published types working under `moduleResolution: node`.
 */
export interface TaskQueue {
  readonly size: number;
  sizeBy(options: { priority?: number }): number;
  add<T>(task: () => Promise<T>, options?: { priority?: number; signal?: AbortSignal }): Promise<T>;
}

export class GenerateCallManager<T_LLM_Req, T_LLM_Res> implements Strategy.GenerateCallManager<T_LLM_Req, T_LLM_Res> {
  taskPQueue: TaskQueue;
  constructor(
    readonly name: string,
    readonly config: GenerateConfig,
    readonly llmStrategy: Strategy.LLM.LLMApi
  ) {
    const concurrency = config.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError(`concurrency of ${name} must be an integer of at least 1, got ${concurrency}`);
    }
    assertTimeout(name, 'streamIdleTimeoutMs', config.streamIdleTimeoutMs);
    assertTimeout(name, 'streamFirstEventTimeoutMs', config.streamFirstEventTimeoutMs);
    this.taskPQueue = new PQueue({ concurrency });
  }

  async addHighPriorityTask(
    llmRequest: Strategy.LLM.LLMRequest<T_LLM_Req>,
    options?: Strategy.LLM.CallOptions
  ): Promise<T_LLM_Res> {
    if (this.getCountOfHighPriorityTaskQueue() >= this.config.highPriorityTasksLimit) {
      throw new TooManyHighPriorityTasksError(`Too many high priority task in ${this.name}`);
    }

    // A task aborted while it waits leaves the queue, so it no longer counts toward highPriorityTasksLimit. The
    // queue gets its own signal that follows the caller's only until the task starts: p-queue frees the slot of a
    // running task whose signal aborts, and the next task would then run while the aborted one still ends.
    const { signal } = options ?? {};
    const waiting = new AbortController();
    const abortWaiting = () => waiting.abort(signal?.reason);
    if (signal?.aborted) abortWaiting();
    signal?.addEventListener('abort', abortWaiting, { once: true });

    try {
      const llmResponse = await this.taskPQueue.add(
        () => {
          signal?.removeEventListener('abort', abortWaiting);
          return this.taskPQueueHandler(llmRequest.llmBody, options);
        },
        { priority: llmRequest.priority, signal: waiting.signal }
      );
      return llmResponse as T_LLM_Res;
    } catch (error) {
      log.error('addHighPriorityTask failed', error);
      throw error;
    } finally {
      signal?.removeEventListener('abort', abortWaiting);
    }
  }

  stop() {
    this.llmStrategy.tokenRateLimiter.stop?.();
  }

  getCountOfHighPriorityTaskQueue() {
    return this.taskPQueue.size - this.taskPQueue.sizeBy({ priority: 0 });
  }

  /**
   * Makes the call, with retries. Without a `reservation` it charges the used tokens and a request on success. With
   * one, the tokens and the request were taken before the call: success settles the tokens to the actual usage, a
   * failure before any provider event, in all its attempts, gives the tokens back, and an aborted call keeps them.
   * The request stays counted in every case, as the provider counts the requests it received, failed ones included.
   *
   * With `options.onEvent` the call streams: each attempt sends `request-start` before the provider call, an attempt
   * that stays silent too long after its first output is aborted with `StreamIdleTimeoutError`, and no attempt is
   * retried once an event reached the consumer.
   */
  async makeGenerateRequest(
    llmRequest: T_LLM_Req,
    options?: Strategy.LLM.CallOptions,
    reservation?: { tokens: number }
  ): Promise<T_LLM_Res> {
    const { tokenRateLimiter } = this.llmStrategy;
    const progress: StreamProgress = { delivered: false, providerEventSeen: false };
    let llmResponse: T_LLM_Res;
    try {
      llmResponse = await this.generateWithRetries(llmRequest, options, progress);
    } catch (error) {
      // Once the provider sent an event, in any attempt, it has started to spend the tokens, so only a call whose
      // attempts all failed before that gives them back
      if (reservation && !options?.signal?.aborted && !progress.providerEventSeen) {
        tokenRateLimiter.setUsedTokens(-reservation.tokens);
      }
      throw error;
    }

    // A response whose usage cannot be read is still a reply, which a streamed call may already have shown; the call
    // then keeps what it reserved, or charges only the request
    let usedTokens: number | undefined;
    try {
      usedTokens = this.llmStrategy.extractUsedTokens(llmResponse);
    } catch (error) {
      log.warn('Could not read the used tokens of the response', providerErrorSummary(error));
    }
    if (reservation) {
      if (usedTokens !== undefined) tokenRateLimiter.setUsedTokens(usedTokens - reservation.tokens);
    } else {
      if (usedTokens !== undefined) tokenRateLimiter.setUsedTokens(usedTokens);
      tokenRateLimiter.setUsedRequest();
    }
    return llmResponse;
  }

  private async generateWithRetries(
    llmRequest: T_LLM_Req,
    options: Strategy.LLM.CallOptions | undefined,
    progress: StreamProgress
  ): Promise<T_LLM_Res> {
    const onEvent = options?.onEvent;
    let attempt = 0;
    let lastError: unknown;

    do {
      try {
        if (!onEvent) return await this.llmStrategy.generate<T_LLM_Req, T_LLM_Res>(llmRequest, options);
        return await this.generateStreamed(llmRequest, { ...options, onEvent }, progress);
      } catch (error) {
        if (!canRetry(error, options, progress)) throw error;
        log.error('makeGenerateRequest attempt failed', error);
        lastError = error;
        attempt++;
        if (attempt < this.config.retryAttemptsLimit) {
          // An abort ends the wait: a Retry-After of up to 60 s holds the queue slot meanwhile
          await waitForRetry(retryDelayMs(error, attempt, this.config.retryDelay), options?.signal);
        }
      }
    } while (attempt < this.config.retryAttemptsLimit);

    log.error('makeGenerateRequest failed after retries');
    throw lastError;
  }

  // One attempt of a streamed call. Its timers abort the provider call through a controller of its own, combined with
  // the caller's signal, and never outlive the attempt, so none runs during the wait before a retry.
  private async generateStreamed(
    llmRequest: T_LLM_Req,
    options: Strategy.LLM.CallOptions & { onEvent: Strategy.LLM.LlmStreamSink },
    progress: StreamProgress
  ): Promise<T_LLM_Res> {
    const { onEvent, signal } = options;
    const idleTimeoutMs = this.config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
    const firstEventTimeoutMs = this.config.streamFirstEventTimeoutMs ?? DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS;
    const attemptController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timerMs: number | undefined;
    let settled = false;
    let idleTimerStarted = false;

    // Replaces the running timer: the first-event timer until the provider's first output, the idle timer after it.
    // No timeout, or 0, turns the timer off.
    const restartTimer = (timeoutMs: number | undefined) => {
      // A stream sends thousands of events, so a timer with the same timeout is restarted, not made again
      if (timer && timeoutMs === timerMs) {
        timer.refresh();
        return;
      }
      clearTimeout(timer);
      timer = undefined;
      timerMs = timeoutMs;
      if (!timeoutMs) return;
      timer = setTimeout(() => attemptController.abort(new StreamIdleTimeoutError(timeoutMs)), timeoutMs);
      // A timer must never keep the process alive
      timer.unref?.();
    };

    const forward = (event: Strategy.LLM.LlmStreamEvent): boolean => {
      try {
        return onEvent(event) === true;
      } catch {
        // A failing consumer must not break the provider's stream. Its error may quote the event, so only the type is
        // logged.
        log.warn(`onEvent failed on a ${event.type} event`);
        return false;
      }
    };

    const providerSink: Strategy.LLM.LlmStreamSink = (event) => {
      // Any provider event means the provider has started to spend tokens, even one sent after its attempt ended
      progress.providerEventSeen = true;
      // An event sent after the attempt ended belongs to no attempt, and is neither shown nor restarts a timer
      if (settled) return false;
      // Nor is one sent after the attempt was aborted shown: the attempt is over, and a retry may still follow
      if (attemptController.signal.aborted || signal?.aborted) return false;
      // A usage report is not output: Anthropic sends one as soon as the message starts, and a model may then think
      // without a word for longer than the idle timeout. The first text, reasoning or activity starts the idle timer,
      // and from then on every provider event restarts it.
      if (event.type !== 'usage' || idleTimerStarted) {
        idleTimerStarted = true;
        restartTimer(idleTimeoutMs);
      }
      const delivered = forward(event);
      if (delivered) progress.delivered = true;
      return delivered;
    };

    // A provider that ignores the abort must not hold the call, and its queue slot, past a timeout or the caller's
    // abort, so the attempt also ends when its timer fires or the caller aborts
    let rejectTimedOut!: (reason: unknown) => void;
    const timedOut = new Promise<never>((_resolve, reject) => (rejectTimedOut = reject));
    const endOnTimeout = () => rejectTimedOut(attemptController.signal.reason);
    // A provider that stops at once rejects with its own abort error before this timer runs, so only one that ignores
    // the abort ends with the caller's reason
    let callerAbortTimer: ReturnType<typeof setTimeout> | undefined;
    const endOnCallerAbort = () => {
      callerAbortTimer = setTimeout(() => rejectTimedOut(signal?.reason), 0);
      callerAbortTimer.unref?.();
    };
    attemptController.signal.addEventListener('abort', endOnTimeout, { once: true });
    signal?.addEventListener('abort', endOnCallerAbort, { once: true });

    forward({ type: 'request-start' });
    restartTimer(firstEventTimeoutMs);
    try {
      // Promise.resolve also takes a provider that returns a plain value or a thenable
      const providerCall = Promise.resolve(
        this.llmStrategy.generate<T_LLM_Req, T_LLM_Res>(llmRequest, {
          ...options,
          signal: signal ? AbortSignal.any([signal, attemptController.signal]) : attemptController.signal,
          onEvent: providerSink
        })
      );
      // Once the timeout ended the attempt, the provider's late result or error is dropped
      providerCall.catch(() => undefined);
      return await Promise.race([providerCall, timedOut]);
    } catch (error) {
      // The caller's abort wins over a timeout
      if (signal?.aborted && attemptController.signal.aborted && error === attemptController.signal.reason) {
        throw signal.reason;
      }
      if (attemptController.signal.aborted && !signal?.aborted) throw attemptController.signal.reason;
      throw error;
    } finally {
      settled = true;
      clearTimeout(timer);
      clearTimeout(callerAbortTimer);
      attemptController.signal.removeEventListener('abort', endOnTimeout);
      signal?.removeEventListener('abort', endOnCallerAbort);
    }
  }

  async taskPQueueHandler(llmRequest: T_LLM_Req, options?: Strategy.LLM.CallOptions) {
    const totalMessage = this.llmStrategy.reduceMessages(llmRequest);
    const predictedTokens = this.llmStrategy.llmTokenizer.calculateTokensFromString(totalMessage);
    const reservation = this.config.reserveTokens === false ? undefined : { tokens: predictedTokens };
    if (reservation) await this.reserveTokens(reservation.tokens, options?.signal);
    else await this.llmStrategy.tokenRateLimiter.awaitBeforeCall(predictedTokens);
    // A rate limiter that does not watch the signal ends its wait first, so a call aborted during that wait ends here.
    // Like any aborted call, it keeps its reservation.
    options?.signal?.throwIfAborted();
    const llmResponse = await this.makeGenerateRequest(llmRequest, options, reservation);
    return llmResponse;
  }

  private async reserveTokens(tokens: number, signal?: AbortSignal) {
    const { tokenRateLimiter } = this.llmStrategy;
    if (tokenRateLimiter.acquire) {
      // A call aborted while it waits ends at once and takes nothing
      await tokenRateLimiter.acquire(tokens, signal);
      return;
    }
    // A rate limiter without acquire() only checks, so calls running at the same time may both pass its check
    await tokenRateLimiter.awaitBeforeCall(tokens);
    tokenRateLimiter.setUsedTokens(tokens);
    tokenRateLimiter.setUsedRequest();
  }
}
