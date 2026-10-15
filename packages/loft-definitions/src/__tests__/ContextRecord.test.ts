import { describe, expect, it } from 'vitest';

import { ContextRecord } from '../schemas/entities/ContextRecord';

describe('ContextRecord', () => {
  it('accepts any JSON object, with lists, null and nesting', () => {
    const ctx = {
      orderId: 'o-1001',
      total: 42.5,
      paid: false,
      tags: ['vip', 'repeat'],
      coupon: null,
      focusStatus: { filled: { size: 'large' }, missing: [], ready: true },
      items: [{ sku: 'p-1', options: ['extra cheese'] }]
    };

    expect(ContextRecord.safeParse(ctx).success).toBe(true);
  });

  it('rejects values that are not JSON objects, and non-JSON values inside them', () => {
    for (const value of [null, 'text', 42, ['a']]) {
      expect(ContextRecord.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
    expect(ContextRecord.safeParse({ when: new Date() }).success).toBe(false);
    expect(ContextRecord.safeParse({ fn: () => 1 }).success).toBe(false);
  });
});
