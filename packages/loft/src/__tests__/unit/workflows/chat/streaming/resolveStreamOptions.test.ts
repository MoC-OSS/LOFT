import { describe, expect, it } from 'vitest';

import { isObserveOnly, resolveStreamOptions } from '../../../../../workflows/chat/streaming/resolveStreamOptions';

describe('resolveStreamOptions', () => {
  it('defaults: enabled, no reasoning, tool names, text streamed', () => {
    expect(resolveStreamOptions()).toEqual({
      enabled: true,
      reasoning: false,
      toolCalls: 'names',
      textPolicy: 'all',
      policyDefaulted: true
    });
  });

  it('call over config', () => {
    const resolved = resolveStreamOptions(
      { enabled: false, include: { reasoning: true, toolCalls: 'args' }, textPolicy: 'after-middleware' },
      { enabled: true, include: { toolCalls: 'none' } }
    );

    // Key by key: the call's keys win, the config fills in the rest
    expect(resolved).toEqual({
      enabled: true,
      reasoning: true,
      toolCalls: 'none',
      textPolicy: 'after-middleware',
      policyDefaulted: false
    });
  });

  it('the default is after-middleware when output middleware exists', () => {
    expect(resolveStreamOptions(undefined, undefined, ['redact'])).toMatchObject({
      textPolicy: 'after-middleware',
      policyDefaulted: true
    });
    expect(resolveStreamOptions({ include: { reasoning: true } }, {}, [])).toMatchObject({
      textPolicy: 'all',
      policyDefaulted: true
    });
  });

  it('an explicit all wins', () => {
    expect(resolveStreamOptions(undefined, { textPolicy: 'all' }, ['redact'])).toMatchObject({
      textPolicy: 'all',
      policyDefaulted: false
    });
    expect(resolveStreamOptions({ textPolicy: 'all' }, undefined, ['redact'])).toMatchObject({
      textPolicy: 'all',
      policyDefaulted: false
    });
    expect(resolveStreamOptions({ textPolicy: 'after-middleware' }, { textPolicy: 'all' }, ['redact']).textPolicy).toBe(
      'all'
    );
  });

  it('enabled: false gives observe-only', () => {
    expect(isObserveOnly(resolveStreamOptions({ enabled: false }))).toBe(true);
    expect(isObserveOnly(resolveStreamOptions(undefined, { enabled: false }))).toBe(true);
    expect(isObserveOnly(resolveStreamOptions())).toBe(false);
  });

  it('text held until the end without reasoning is observe-only', () => {
    expect(isObserveOnly(resolveStreamOptions(undefined, undefined, ['redact']))).toBe(true);
    expect(isObserveOnly(resolveStreamOptions(undefined, { include: { reasoning: true } }, ['redact']))).toBe(false);
  });
});
