import { ExponentialBackoffPoller, PollingConfig } from '@moc-global/loft-definitions';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';

describe('ExponentialBackoffPoller', () => {
  let pollFunction: Mock;
  let poller: ExponentialBackoffPoller;
  let config: PollingConfig & { timeCoefficient: number };

  const minTime = 100;
  const maxTime = 1600;

  beforeEach(() => {
    vi.useFakeTimers();
    pollFunction = vi.fn(() => Promise.resolve(true));
    config = { minTime, maxTime, timeCoefficient: 2 };
    poller = new ExponentialBackoffPoller(config, pollFunction);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  it('should call pollFunction initially and reset the interval on success', async () => {
    poller.start();
    expect(pollFunction).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(minTime);
    expect(pollFunction).toHaveBeenCalledTimes(2);
  });

  it('should exponentially increase the interval on failure', async () => {
    pollFunction.mockRejectedValue(new Error('No data'));
    let currentInterval = minTime;
    poller.start();

    expect(pollFunction).toHaveBeenCalledTimes(1);

    currentInterval *= config.timeCoefficient;
    await vi.advanceTimersByTimeAsync(currentInterval);

    expect(pollFunction).toHaveBeenCalledTimes(2);

    currentInterval *= config.timeCoefficient;
    await vi.advanceTimersByTimeAsync(currentInterval);

    expect(pollFunction).toHaveBeenCalledTimes(3);
  });

  it('should not exceed maxTime', async () => {
    pollFunction.mockRejectedValue(new Error('No data'));

    poller.start();
    await vi.advanceTimersByTimeAsync(minTime);

    for (let i = 1; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(Math.min(minTime * Math.pow(config.timeCoefficient, i), maxTime));
    }

    expect(pollFunction).toHaveBeenCalledTimes(10);
  });

  it('should reset the interval on success after a failure', async () => {
    pollFunction.mockRejectedValueOnce(new Error('No data')).mockResolvedValue(true);

    poller.start();
    expect(pollFunction).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(minTime * config.timeCoefficient);
    expect(pollFunction).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(minTime);
    expect(pollFunction).toHaveBeenCalledTimes(3);
  });

  it('does not poll again after stop()', async () => {
    poller.start();
    await vi.advanceTimersByTimeAsync(minTime);
    expect(pollFunction).toHaveBeenCalledTimes(2);

    poller.stop();
    await vi.advanceTimersByTimeAsync(maxTime * 2);

    expect(pollFunction).toHaveBeenCalledTimes(2);
  });

  it('does not schedule the next poll when stopped while a poll is running', async () => {
    let finishPoll: (value: boolean) => void = () => {};
    pollFunction.mockImplementationOnce(() => new Promise<boolean>((resolve) => (finishPoll = resolve)));

    poller.start();
    poller.stop();
    finishPoll(true);
    await vi.advanceTimersByTimeAsync(maxTime * 2);

    expect(pollFunction).toHaveBeenCalledTimes(1);
  });

  it('keeps the process alive while waiting for the next poll, until stop()', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    // A queue worker has no other handle: an unref'd timer would let it exit while it should keep polling
    const timer = setTimeoutSpy.mock.results[0].value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(true);
    poller.stop();
  });
});
