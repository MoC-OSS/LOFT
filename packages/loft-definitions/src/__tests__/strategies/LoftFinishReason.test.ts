import { describe, expect, it } from 'vitest';

import { Strategy } from '../..';

describe('LoftFinishReason', () => {
  // Saved responses and traces carry these strings, so they must not change
  it('keeps the values LOFT has always written', () => {
    expect({ ...Strategy.LLM.LoftFinishReason }).toEqual({
      INTERCEPTOR_OVERRIDE: 'interceptor_override',
      MIDDLEWARE_OVERRIDE: 'middleware_override',
      MAX_LOOPS_EXCEEDED: 'max_loops_exceeded'
    });
  });
});
