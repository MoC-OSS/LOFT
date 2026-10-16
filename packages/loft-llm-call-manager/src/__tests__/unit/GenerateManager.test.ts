import { Interface, Logger, Strategy } from '@moc-global/loft-definitions';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GenerateCallManager } from '../../GenerateManager';
import { GenerateConfig } from '../../types';

type Body = { messages: string[] };

const BODY: Body = { messages: ['hello'] };
const REQUEST: Strategy.LLM.LLMRequest<Body> = {
  sessionId: 'session-1',
  requestType: Strategy.LLM.LLMRequestType.GENERATE,
  llmName: 'fake',
  llmBody: BODY,
  priority: 30
};
const CONFIG: GenerateConfig = { highPriorityTasksLimit: 10, retryDelay: 0, retryAttemptsLimit: 3 };

describe('GenerateCallManager', () => {
  const generate = vi.fn<(llmRequest: Body, options?: Strategy.LLM.CallOptions) => Promise<unknown>>();
  const awaitBeforeCall = vi.fn<(requestedTokens?: number) => Promise<void>>();
  let manager: GenerateCallManager<Body, unknown>;

  beforeAll(() => {
    Logger.configure({ logLevel: Interface.LogLevel.NONE });
  });

  beforeEach(() => {
    generate.mockReset();
    awaitBeforeCall.mockReset().mockResolvedValue(undefined);
    const llmApi = {
      generate,
      reduceMessages: () => 'hello',
      extractUsedTokens: () => 1,
      tokenRateLimiter: { awaitBeforeCall, setUsedTokens: vi.fn(), setUsedRequest: vi.fn() },
      llmTokenizer: { calculateTokensFromString: () => 1 }
    } as unknown as Strategy.LLM.LLMApi;
    manager = new GenerateCallManager('test', CONFIG, llmApi);
  });

  describe('abort signal', () => {
    it('passes the signal to llmStrategy.generate', async () => {
      const { signal } = new AbortController();
      generate.mockResolvedValue('response');

      await expect(manager.addHighPriorityTask(REQUEST, { signal })).resolves.toBe('response');

      expect(generate).toHaveBeenCalledWith(BODY, { signal });
    });

    it('rejects an already-aborted call without calling generate', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(manager.addHighPriorityTask(REQUEST, { signal: controller.signal })).rejects.toMatchObject({
        name: 'AbortError'
      });

      expect(awaitBeforeCall).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
    });

    it('does not call generate when aborted while waiting for the rate limiter', async () => {
      const controller = new AbortController();
      awaitBeforeCall.mockImplementation(async () => controller.abort());

      await expect(manager.addHighPriorityTask(REQUEST, { signal: controller.signal })).rejects.toMatchObject({
        name: 'AbortError'
      });

      expect(generate).not.toHaveBeenCalled();
    });

    it('does not retry a call that failed because it was aborted', async () => {
      const controller = new AbortController();
      generate.mockImplementation(async () => {
        controller.abort();
        throw new Error('request aborted');
      });

      await expect(manager.addHighPriorityTask(REQUEST, { signal: controller.signal })).rejects.toThrow(
        'request aborted'
      );

      expect(generate).toHaveBeenCalledTimes(1);
    });
  });

  describe('retries without a signal', () => {
    it('retries a failing call and returns the first success', async () => {
      generate.mockRejectedValueOnce(new Error('fail 1')).mockRejectedValueOnce(new Error('fail 2'));
      generate.mockResolvedValue('response');

      await expect(manager.addHighPriorityTask(REQUEST)).resolves.toBe('response');

      expect(generate).toHaveBeenCalledTimes(3);
      expect(generate).toHaveBeenLastCalledWith(BODY, undefined);
    });

    it('rejects with the last error after retryAttemptsLimit attempts', async () => {
      generate.mockRejectedValueOnce(new Error('fail 1')).mockRejectedValueOnce(new Error('fail 2'));
      generate.mockRejectedValue(new Error('fail 3'));

      await expect(manager.addHighPriorityTask(REQUEST)).rejects.toThrow('fail 3');

      expect(generate).toHaveBeenCalledTimes(CONFIG.retryAttemptsLimit);
    });
  });

  describe('task queue', () => {
    const request = (text: string, priority: number) => ({ ...REQUEST, llmBody: { messages: [text] }, priority });

    // The first call holds the queue, so the next ones wait and are ordered by priority
    function holdFirstCall() {
      let release!: () => void;
      generate.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve('first'))));
      generate.mockImplementation(async (body) => body.messages[0]);
      return () => release();
    }

    it('runs one call at a time, the higher priority first', async () => {
      const release = holdFirstCall();
      const first = manager.addHighPriorityTask(request('first', 30));
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));

      const low = manager.addHighPriorityTask(request('low', 10));
      const high = manager.addHighPriorityTask(request('high', 50));
      expect(manager.getCountOfHighPriorityTaskQueue()).toBe(2);
      release();

      await expect(Promise.all([first, low, high])).resolves.toEqual(['first', 'low', 'high']);
      expect(generate.mock.calls.map(([body]) => body.messages[0])).toEqual(['first', 'high', 'low']);
    });

    it('rejects a call once highPriorityTasksLimit calls are waiting', async () => {
      const llmApi = {
        generate,
        reduceMessages: () => 'hello',
        extractUsedTokens: () => 1,
        tokenRateLimiter: { awaitBeforeCall, setUsedTokens: vi.fn(), setUsedRequest: vi.fn() },
        llmTokenizer: { calculateTokensFromString: () => 1 }
      } as unknown as Strategy.LLM.LLMApi;
      const limited = new GenerateCallManager<Body, unknown>('test', { ...CONFIG, highPriorityTasksLimit: 1 }, llmApi);
      const release = holdFirstCall();
      const first = limited.addHighPriorityTask(request('first', 30));
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
      const waiting = limited.addHighPriorityTask(request('waiting', 30));

      await expect(limited.addHighPriorityTask(request('rejected', 30))).rejects.toThrow('Too many high priority task');
      release();
      await expect(Promise.all([first, waiting])).resolves.toEqual(['first', 'waiting']);
    });
  });

  describe('stop', () => {
    it('stops the rate limiter of the LLM strategy', () => {
      const stop = vi.fn();
      const llmApi = { tokenRateLimiter: { stop } } as unknown as Strategy.LLM.LLMApi;

      new GenerateCallManager('test', CONFIG, llmApi).stop();

      expect(stop).toHaveBeenCalledTimes(1);
    });

    it('works with a rate limiter that has no stop()', () => {
      expect(() => manager.stop()).not.toThrow();
    });
  });
});
