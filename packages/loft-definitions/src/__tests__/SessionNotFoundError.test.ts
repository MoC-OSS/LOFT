import { describe, expect, it } from 'vitest';

import { Chat, ChatError, SessionNotFoundError } from '..';

describe('SessionNotFoundError', () => {
  it('names the session id in the message', () => {
    const error = new SessionNotFoundError({ sessionId: 'session-1' });

    expect(error).toBeInstanceOf(ChatError);
    expect(error.name).toBe('SessionNotFoundError');
    expect(error.message).toBe('Session with id session-1 not found');
    expect(error.sessionId).toBe('session-1');
    expect(error.externalKey).toBeUndefined();
    expect(error.status).toBe(Chat.Status.ERROR);
    expect(error.shouldRetry()).toBe(false);
  });

  it('keeps the external key the session was looked up by', () => {
    const error = new SessionNotFoundError({ externalKey: { crmId: 'external-1' } });

    expect(error.message).toBe('Session with externalKey {"crmId":"external-1"} not found');
    expect(error.sessionId).toBe('');
    expect(error.externalKey).toEqual({ crmId: 'external-1' });
  });

  it('takes a message of its own', () => {
    expect(new SessionNotFoundError({ sessionId: 'session-1' }, 'No such chat').message).toBe('No such chat');
  });
});
