import { Interface, Logger, Strategy } from '@moc-global/loft-definitions';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { LlmCallManagerLongAwaitError } from '../../errors';
import { GenerateWithQueueManager } from '../../GenerateWithQueueManager';
import { GenerateWithQueueConfig } from '../../types';

const CONFIG: GenerateWithQueueConfig = {
  highPriorityTasksLimit: 10,
  retryDelay: 0,
  retryAttemptsLimit: 1,
  minPollerInterval: 10,
  maxPollerInterval: 100,
  pollerTimeCoefficient: 2
};

const TASK = { sessionId: 'session-1', llmName: 'fake', llmBody: { messages: ['hello'] }, callContext: {} };

describe('GenerateWithQueueManager', () => {
  const generate = vi.fn<(llmRequest: unknown) => Promise<unknown>>();
  const consume = vi.fn<() => Promise<string | undefined>>();
  const incomingPublish = vi.fn<(message: string) => Promise<void>>();
  const outgoingPublish = vi.fn<(message: string) => Promise<void>>();
  const unhandled = vi.fn();
  const stopRateLimiter = vi.fn();
  const awaitBeforeCall = vi.fn();
  const deadLetterPublish = vi.fn<(message: string) => Promise<void>>();
  const managers: GenerateWithQueueManager<unknown, unknown>[] = [];

  // The manager starts polling the queue as soon as it is constructed
  function startManager(options: { deadLetter?: boolean; config?: Partial<GenerateWithQueueConfig> } = {}) {
    const llmApi = {
      generate,
      reduceMessages: () => 'hello',
      extractUsedTokens: () => 1,
      generateRequestValidationSchema: () =>
        z.object({ sessionId: z.string(), llmName: z.string(), llmBody: z.unknown(), callContext: z.unknown() }),
      tokenRateLimiter: {
        awaitBeforeCall,
        setUsedTokens: vi.fn(),
        setUsedRequest: vi.fn(),
        stop: stopRateLimiter
      },
      llmTokenizer: { calculateTokensFromString: () => 1 }
    } as unknown as Strategy.LLM.LLMApi;
    const queue = (publish: typeof incomingPublish) =>
      ({ publish, consume, subscribe: vi.fn() }) as unknown as Strategy.LoftQueue;

    const manager = new GenerateWithQueueManager<unknown, unknown>(
      'test',
      { ...CONFIG, ...options.config },
      llmApi,
      queue(incomingPublish),
      queue(outgoingPublish),
      options.deadLetter ? queue(deadLetterPublish) : undefined
    );
    managers.push(manager);
    return manager;
  }

  beforeAll(() => {
    Logger.configure({ logLevel: Interface.LogLevel.NONE });
  });

  beforeEach(() => {
    // setImmediate stays real so the test can wait for unhandled-rejection reports
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    process.on('unhandledRejection', unhandled);
    for (const mock of [
      generate,
      consume,
      incomingPublish,
      outgoingPublish,
      deadLetterPublish,
      unhandled,
      stopRateLimiter,
      awaitBeforeCall
    ]) {
      mock.mockReset();
    }
    incomingPublish.mockResolvedValue(undefined);
    outgoingPublish.mockResolvedValue(undefined);
    consume.mockResolvedValueOnce(JSON.stringify(TASK)).mockResolvedValue(undefined);
  });

  afterEach(() => {
    managers.splice(0).forEach((manager) => manager.stop());
    process.off('unhandledRejection', unhandled);
    vi.useRealTimers();
  });

  it('publishes the result of a queued task', async () => {
    generate.mockResolvedValue('response');
    startManager();

    await vi.advanceTimersByTimeAsync(50);

    expect(outgoingPublish).toHaveBeenCalledTimes(1);
    expect(JSON.parse(outgoingPublish.mock.calls[0][0])).toMatchObject({
      sessionId: 'session-1',
      llmBody: 'response'
    });
  });

  it('logs a failed queued task instead of leaving an unhandled rejection', async () => {
    generate.mockRejectedValue(new Error('LLM down'));
    startManager();

    await vi.advanceTimersByTimeAsync(50);
    // Unhandled rejections are reported on a later turn of the event loop
    await new Promise((resolve) => setImmediate(resolve));

    expect(generate).toHaveBeenCalled();
    expect(outgoingPublish).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
  });

  describe('a task that waits too long for the rate limiter', () => {
    const published = (publish: typeof incomingPublish) => publish.mock.calls.map(([message]) => JSON.parse(message));

    beforeEach(() => {
      awaitBeforeCall.mockRejectedValue(new LlmCallManagerLongAwaitError('Too long await before call'));
    });

    it('goes back to the incoming queue with its attempts counted', async () => {
      consume.mockReset().mockResolvedValueOnce(JSON.stringify({ ...TASK, requeueAttempts: 2 }));
      consume.mockResolvedValue(undefined);
      startManager();

      await vi.advanceTimersByTimeAsync(50);

      expect(published(incomingPublish)).toEqual([{ ...TASK, requeueAttempts: 3 }]);
      expect(outgoingPublish).not.toHaveBeenCalled();
    });

    it('goes to the outgoing queue as an error after maxRequeueAttempts', async () => {
      consume.mockReset().mockResolvedValueOnce(JSON.stringify({ ...TASK, requeueAttempts: 3 }));
      consume.mockResolvedValue(undefined);
      startManager({ config: { maxRequeueAttempts: 3 } });

      await vi.advanceTimersByTimeAsync(50);

      expect(incomingPublish).not.toHaveBeenCalled();
      expect(published(outgoingPublish)).toEqual([
        {
          sessionId: 'session-1',
          llmName: 'fake',
          callContext: {},
          priority: 0,
          error: { name: 'LlmCallManagerLongAwaitError', message: 'Too long await before call' }
        }
      ]);
    });

    it('goes to the dead-letter queue after maxRequeueAttempts when there is one', async () => {
      consume.mockReset().mockResolvedValueOnce(JSON.stringify({ ...TASK, requeueAttempts: 10 }));
      consume.mockResolvedValue(undefined);
      startManager({ deadLetter: true });

      await vi.advanceTimersByTimeAsync(50);

      expect(incomingPublish).not.toHaveBeenCalled();
      expect(outgoingPublish).not.toHaveBeenCalled();
      expect(published(deadLetterPublish)).toEqual([
        {
          ...TASK,
          requeueAttempts: 10,
          error: { name: 'LlmCallManagerLongAwaitError', message: 'Too long await before call' }
        }
      ]);
    });
  });

  it('stops polling the queue and the rate limiter on stop()', async () => {
    consume.mockReset().mockResolvedValue(undefined);
    const manager = startManager();
    await vi.advanceTimersByTimeAsync(50);
    const pollsBeforeStop = consume.mock.calls.length;
    expect(pollsBeforeStop).toBeGreaterThan(0);

    manager.stop();
    await vi.advanceTimersByTimeAsync(500);

    expect(consume).toHaveBeenCalledTimes(pollsBeforeStop);
    expect(stopRateLimiter).toHaveBeenCalledTimes(1);
  });
});
