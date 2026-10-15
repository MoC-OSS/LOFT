import { describe, expect, it } from 'vitest';

import { Chat, GenerateError, ShutdownError } from '..';

describe('ChatError', () => {
  it('appends the cause to the stack of a subclass', () => {
    const cause = new Error('provider is down');

    const error = new GenerateError('session-1', [], [], Chat.Status.ERROR, 'Generation failed', cause);

    expect(error.cause).toBe(cause);
    expect(error.name).toBe('GenerateError');
    expect(error.stack).toMatch(/^GenerateError: Generation failed\n/);
    expect(error.stack).toContain('Caused by: Error: provider is down');
  });

  it('starts the stack at the code that threw, not in the error constructors', () => {
    const error = new ShutdownError('operation-1', 'Shutting down');

    expect(error.stack?.split('\n')[1]).toContain('ChatError.test.ts');
  });
});
