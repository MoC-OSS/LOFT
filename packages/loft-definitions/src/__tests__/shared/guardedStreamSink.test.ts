import { describe, expect, it, vi } from 'vitest';

import { guardedStreamSink, Strategy } from '../..';

describe('guardedStreamSink', () => {
  it('passes every event on', () => {
    const onEvent = vi.fn<Strategy.LLM.LlmStreamSink>();
    const sink = guardedStreamSink(onEvent, () => {});

    sink({ type: 'text-delta', delta: 'Hel' });
    sink({ type: 'activity' });

    expect(onEvent.mock.calls).toEqual([[{ type: 'text-delta', delta: 'Hel' }], [{ type: 'activity' }]]);
  });

  it('a sink that throws does not throw, and only its first failure is reported, by event type', () => {
    const onEvent = vi.fn<Strategy.LLM.LlmStreamSink>(() => {
      throw new Error('secret delta text');
    });
    const warn = vi.fn<(message: string) => void>();
    const sink = guardedStreamSink(onEvent, warn);

    expect(() => sink({ type: 'text-delta', delta: 'secret delta text' })).not.toThrow();
    sink({ type: 'activity' });

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls).toEqual([['onEvent threw on a text-delta event; later failures are not logged']]);
  });
});
