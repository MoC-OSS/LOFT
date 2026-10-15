import { describe, expect, it } from 'vitest';

import { SharedContext } from '../../core/SharedContext';

describe('SharedContext', () => {
  it('should store and retrieve a value', () => {
    const ctx = new SharedContext('session-1');
    ctx.set('foo', 42);
    expect(ctx.get<number>('foo')).toBe(42);
  });

  it('should return undefined for missing key', () => {
    const ctx = new SharedContext('session-1');
    expect(ctx.get('nonexistent')).toBeUndefined();
  });

  it('should expose sessionId', () => {
    const ctx = new SharedContext('session-1');
    expect(ctx.sessionId).toBe('session-1');
  });

  it('should list all keys', () => {
    const ctx = new SharedContext('session-1');
    ctx.set('a', 1);
    ctx.set('b', 2);
    expect(ctx.keys()).toEqual(expect.arrayContaining(['a', 'b']));
    expect(ctx.keys()).toHaveLength(2);
  });

  it('should delete a key and return true', () => {
    const ctx = new SharedContext('session-1');
    ctx.set('foo', 1);
    expect(ctx.delete('foo')).toBe(true);
    expect(ctx.get('foo')).toBeUndefined();
  });

  it('should return false when deleting a missing key', () => {
    const ctx = new SharedContext('session-1');
    expect(ctx.delete('nonexistent')).toBe(false);
  });

  it('should return defensive copies on get (structuredClone)', () => {
    const ctx = new SharedContext('session-1');
    ctx.set('obj', { a: 1 });

    const result = ctx.get<{ a: number }>('obj')!;
    result.a = 99;

    expect(ctx.get<{ a: number }>('obj')).toEqual({ a: 1 });
  });
});

describe('ScopedContext', () => {
  it('should auto-prefix keys with agent name on set', () => {
    const ctx = new SharedContext('session-1');
    ctx.for('sentiment').set('mood', 'positive');
    expect(ctx.get<string>('sentiment.mood')).toBe('positive');
  });

  it('should auto-prefix keys with agent name on get', () => {
    const ctx = new SharedContext('session-1');
    ctx.set('router.intent', 'billing');
    expect(ctx.for('router').get<string>('intent')).toBe('billing');
  });

  it('should not collide between different agent scopes', () => {
    const ctx = new SharedContext('session-1');
    ctx.for('agentA').set('score', 10);
    ctx.for('agentB').set('score', 20);

    expect(ctx.for('agentA').get<number>('score')).toBe(10);
    expect(ctx.for('agentB').get<number>('score')).toBe(20);
  });

  it('should return defensive copies on get', () => {
    const ctx = new SharedContext('session-1');
    ctx.for('agent').set('data', { x: 1 });

    const result = ctx.for('agent').get<{ x: number }>('data')!;
    result.x = 99;

    expect(ctx.for('agent').get<{ x: number }>('data')).toEqual({ x: 1 });
  });
});
