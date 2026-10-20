import { isRetryableError } from '@moc-global/loft-definitions';
import { APIConnectionError, APIConnectionTimeoutError } from 'openai';
import { describe, expect, it } from 'vitest';

// The SDK's own error classes, whose instances are named 'Error', not after their class
describe('the retry policy with the SDK connection errors', () => {
  it('retries a timeout', () => {
    expect(isRetryableError(new APIConnectionTimeoutError())).toBe(true);
  });

  it('retries a connection error without a cause', () => {
    expect(isRetryableError(new APIConnectionError({}))).toBe(true);
  });
});
