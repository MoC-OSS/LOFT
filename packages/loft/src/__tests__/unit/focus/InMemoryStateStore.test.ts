import { describe, expect, it, vi } from 'vitest';

import { InMemoryFocusStateStore } from '../../../focus/InMemoryStateStore';

describe('InMemoryFocusStateStore', () => {
  describe('basic CRUD', () => {
    it('should set and get a value', async () => {
      const store = new InMemoryFocusStateStore();
      await store.set('session-1', 'agent-1', 'field', 'value');
      expect(await store.get('session-1', 'agent-1', 'field')).toBe('value');
    });

    it('should return undefined for unknown field', async () => {
      const store = new InMemoryFocusStateStore();
      expect(await store.get('session-1', 'agent-1', 'missing')).toBeUndefined();
    });

    it('should return all values via getAll', async () => {
      const store = new InMemoryFocusStateStore();
      await store.set('s', 'a', 'x', 1);
      await store.set('s', 'a', 'y', 2);
      expect(await store.getAll('s', 'a')).toEqual({ x: 1, y: 2 });
    });

    it('should delete a single field', async () => {
      const store = new InMemoryFocusStateStore();
      await store.set('s', 'a', 'field', 'v');
      await store.delete('s', 'a', 'field');
      expect(await store.get('s', 'a', 'field')).toBeUndefined();
    });

    it('should clear a specific agent', async () => {
      const store = new InMemoryFocusStateStore();
      await store.set('s', 'a', 'f', 'v');
      await store.clear('s', 'a');
      expect(await store.getAll('s', 'a')).toEqual({});
    });

    it('should clearAll for a session', async () => {
      const store = new InMemoryFocusStateStore();
      await store.set('s', 'a', 'f', 'v');
      await store.set('s', 'b', 'f', 'v');
      await store.clearAll('s');
      expect(await store.getAll('s', 'a')).toEqual({});
      expect(await store.getAll('s', 'b')).toEqual({});
    });

    it('should isolate sessions from each other', async () => {
      const store = new InMemoryFocusStateStore();
      await store.set('session-1', 'agent', 'field', 'value-1');
      await store.set('session-2', 'agent', 'field', 'value-2');
      expect(await store.get('session-1', 'agent', 'field')).toBe('value-1');
      expect(await store.get('session-2', 'agent', 'field')).toBe('value-2');
    });
  });

  describe('TTL eviction', () => {
    it('should return value before TTL expires', async () => {
      const store = new InMemoryFocusStateStore(5000);
      await store.set('s', 'a', 'f', 'v');
      expect(await store.get('s', 'a', 'f')).toBe('v');
    });

    it('should evict entry lazily after TTL expires', async () => {
      vi.useFakeTimers();
      const store = new InMemoryFocusStateStore(1000);

      await store.set('s', 'a', 'f', 'v');
      expect(await store.get('s', 'a', 'f')).toBe('v');

      vi.advanceTimersByTime(1001);

      expect(await store.get('s', 'a', 'f')).toBeUndefined();
      expect(await store.getAll('s', 'a')).toEqual({});

      vi.useRealTimers();
    });

    it('should reset TTL on each set call', async () => {
      vi.useFakeTimers();
      const store = new InMemoryFocusStateStore(1000);

      await store.set('s', 'a', 'f', 'v1');
      vi.advanceTimersByTime(800);

      await store.set('s', 'a', 'f', 'v2'); // resets TTL
      vi.advanceTimersByTime(800); // only 800ms since last write

      expect(await store.get('s', 'a', 'f')).toBe('v2');

      vi.useRealTimers();
    });

    it('should evict only the expired (sessionId, agentName) pair, not others', async () => {
      vi.useFakeTimers();
      const store = new InMemoryFocusStateStore(1000);

      await store.set('s', 'agent-a', 'f', 'v-a');
      vi.advanceTimersByTime(500);
      await store.set('s', 'agent-b', 'f', 'v-b'); // written 500ms later

      vi.advanceTimersByTime(600); // agent-a is now 1100ms old, agent-b is 600ms old

      expect(await store.get('s', 'agent-a', 'f')).toBeUndefined(); // evicted
      expect(await store.get('s', 'agent-b', 'f')).toBe('v-b'); // still alive

      vi.useRealTimers();
    });

    it('should not evict when ttlMs is 0 (default)', async () => {
      vi.useFakeTimers();
      const store = new InMemoryFocusStateStore(); // default ttlMs = 0

      await store.set('s', 'a', 'f', 'v');
      vi.advanceTimersByTime(999999);

      expect(await store.get('s', 'a', 'f')).toBe('v');

      vi.useRealTimers();
    });
  });
});
