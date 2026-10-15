import { describe, expect, it } from 'vitest';

import { Schema } from '../..';

describe('CreateSession schema', () => {
  const validBase = {
    ctx: {},
    currentLlmName: 'test-llm',
    currentManifestName: 'test-manifest',
    externalKey: {}
  };

  it('should accept valid session without focusAgent', () => {
    const result = Schema.Entity.CreateSession.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it('should accept focusAgent as a string', () => {
    const result = Schema.Entity.CreateSession.safeParse({ ...validBase, focusAgent: 'intake' });
    expect(result.success).toBe(true);
    expect(result.data!.focusAgent).toBe('intake');
  });

  it('should accept focusAgent as null', () => {
    const result = Schema.Entity.CreateSession.safeParse({ ...validBase, focusAgent: null });
    expect(result.success).toBe(true);
    expect(result.data!.focusAgent).toBeNull();
  });

  it('should accept focusAgent as undefined (omitted)', () => {
    const result = Schema.Entity.CreateSession.safeParse(validBase);
    expect(result.success).toBe(true);
    expect(result.data!.focusAgent).toBeUndefined();
  });

  it('should reject focusAgent as a number', () => {
    const result = Schema.Entity.CreateSession.safeParse({ ...validBase, focusAgent: 123 });
    expect(result.success).toBe(false);
  });
});
