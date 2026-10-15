import { describe, expect, it } from 'vitest';

import { NodeTimeoutError } from '../../errors';
import { withTimeout } from '../../policies/TimeoutPolicy';

describe('withTimeout', () => {
  it('should resolve when function completes before timeout', async () => {
    const result = await withTimeout(async () => 'done', { timeoutMs: 1000 }, 'testNode');
    expect(result).toBe('done');
  });

  it('should throw NodeTimeoutError when function exceeds timeout', async () => {
    const slowFn = () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 500));

    await expect(withTimeout(slowFn, { timeoutMs: 10 }, 'slowNode')).rejects.toThrow(NodeTimeoutError);
  });

  it('should include nodeName and timeoutMs in error', async () => {
    const slowFn = () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 500));

    try {
      await withTimeout(slowFn, { timeoutMs: 10 }, 'myNode');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NodeTimeoutError);
      const err = e as NodeTimeoutError;
      expect(err.nodeName).toBe('myNode');
      expect(err.timeoutMs).toBe(10);
    }
  });

  it('should propagate errors from the function', async () => {
    const failFn = async () => {
      throw new Error('inner error');
    };

    await expect(withTimeout(failFn, { timeoutMs: 1000 }, 'testNode')).rejects.toThrow('inner error');
  });

  it('should abort the signal when timeout fires', async () => {
    let receivedSignal: AbortSignal | undefined;

    const slowFn = (signal: AbortSignal) =>
      new Promise<string>((resolve) => {
        receivedSignal = signal;
        setTimeout(() => resolve('late'), 500);
      });

    await expect(withTimeout(slowFn, { timeoutMs: 10 }, 'abortNode')).rejects.toThrow(NodeTimeoutError);
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('should not abort the signal when function completes in time', async () => {
    let receivedSignal: AbortSignal | undefined;

    const fastFn = async (signal: AbortSignal) => {
      receivedSignal = signal;
      return 'done';
    };

    await withTimeout(fastFn, { timeoutMs: 1000 }, 'fastNode');
    expect(receivedSignal?.aborted).toBe(false);
  });

  it('should give the timeout error as the abort reason', async () => {
    let receivedSignal: AbortSignal | undefined;
    const slowFn = (signal: AbortSignal) =>
      new Promise<string>((resolve) => {
        receivedSignal = signal;
        setTimeout(() => resolve('late'), 500);
      });

    await expect(withTimeout(slowFn, { timeoutMs: 10 }, 'abortNode')).rejects.toThrow(NodeTimeoutError);
    expect(receivedSignal?.reason).toBeInstanceOf(NodeTimeoutError);
  });

  it('should abort the function when the parent signal aborts', async () => {
    const parent = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const fn = (signal: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        receivedSignal = signal;
        signal.addEventListener('abort', () => reject(new Error('cancelled')));
      });

    const pending = withTimeout(fn, { timeoutMs: 1000 }, 'parentNode', parent.signal);
    parent.abort();

    await expect(pending).rejects.toThrow('cancelled');
    expect(receivedSignal?.aborted).toBe(true);
  });
});
