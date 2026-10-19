import axios from 'axios';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpCallManagerStrategy, Interface, Logger, NativeCallManagerStrategy, Strategy } from '../..';

// axios is callable (streamCall uses axios(config)) and has post()
vi.mock('axios', () => ({ default: Object.assign(vi.fn(), { post: vi.fn(), get: vi.fn() }) }));

const REQUEST: Strategy.LLM.LLMRequest<{ prompt: string }> = {
  sessionId: 'session-1',
  requestType: Strategy.LLM.LLMRequestType.GENERATE,
  llmName: 'fake',
  llmBody: { prompt: 'hello' }
};

beforeAll(() => {
  Logger.configure({ logLevel: Interface.LogLevel.NONE });
});

describe('HttpCallManagerStrategy', () => {
  const URL = 'http://call-manager.local';
  const post = vi.mocked(axios.post);
  const strategy = new HttpCallManagerStrategy({ llmCallManagerUrl: URL, retryAttempts: 3 });

  beforeEach(() => {
    post.mockReset();
  });

  it('passes the signal to axios.post', async () => {
    const { signal } = new AbortController();
    post.mockResolvedValue({ data: { llmBody: 'response' } });

    await expect(strategy.call(REQUEST, { signal })).resolves.toEqual({ llmBody: 'response' });

    expect(post).toHaveBeenCalledWith(URL, REQUEST, { signal });
  });

  it('does not retry a call that failed because it was aborted', async () => {
    const controller = new AbortController();
    post.mockImplementation(async () => {
      controller.abort();
      throw new Error('canceled');
    });

    await expect(strategy.call(REQUEST, { signal: controller.signal })).rejects.toThrow('canceled');

    expect(post).toHaveBeenCalledTimes(1);
  });

  it('retries a failing call without a signal', async () => {
    post.mockRejectedValueOnce(new Error('fail 1')).mockRejectedValueOnce(new Error('fail 2'));
    post.mockResolvedValue({ data: { llmBody: 'response' } });

    await expect(strategy.call(REQUEST)).resolves.toEqual({ llmBody: 'response' });

    expect(post).toHaveBeenCalledTimes(3);
  });

  it('keeps the last failure as the cause once every attempt failed', async () => {
    const lastFailure = new Error('fail 3');
    post.mockRejectedValueOnce(new Error('fail 1')).mockRejectedValueOnce(new Error('fail 2'));
    post.mockRejectedValueOnce(lastFailure);

    await expect(strategy.call(REQUEST)).rejects.toMatchObject({
      message: "CallManager doesn't work",
      cause: lastFailure
    });
  });

  it('keeps the last failure of streamCall as the cause', async () => {
    const lastFailure = new Error('stream failed');
    vi.mocked(axios).mockReset().mockRejectedValue(lastFailure);

    await expect(strategy.streamCall(REQUEST)).rejects.toMatchObject({
      message: "stream call doesn't work",
      cause: lastFailure
    });
    expect(axios).toHaveBeenCalledTimes(3);
  });
});

describe('NativeCallManagerStrategy', () => {
  it('forwards the call options to addHighPriorityTask', async () => {
    const { signal } = new AbortController();
    const addHighPriorityTask = vi.fn().mockResolvedValue('response');
    const strategy = new NativeCallManagerStrategy({
      addHighPriorityTask
    } as unknown as Strategy.GenerateCallManager<unknown, unknown>);

    await expect(strategy.call(REQUEST, { signal })).resolves.toEqual({ llmBody: 'response' });

    expect(addHighPriorityTask).toHaveBeenCalledWith(REQUEST, { signal });
  });

  it('stops the generate call manager on stop()', () => {
    const stop = vi.fn();
    const strategy = new NativeCallManagerStrategy({ stop } as unknown as Strategy.GenerateCallManager<
      unknown,
      unknown
    >);

    strategy.stop();

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stop() works with a generate call manager that has no stop()', () => {
    const strategy = new NativeCallManagerStrategy({} as Strategy.GenerateCallManager<unknown, unknown>);

    expect(() => strategy.stop()).not.toThrow();
  });
});
