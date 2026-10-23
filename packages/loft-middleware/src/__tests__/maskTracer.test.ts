import { describe, expect, it } from 'vitest';

import { maskTracer, maskTracerFactory } from '../maskTracer';
import type { LoftMiddleware } from '../types';
import { RecordingTracerFactory } from './recordingTracer';

const hideSecret: LoftMiddleware = { name: 'hide', maskTrace: (text) => text.replaceAll('secret', '[hidden]') };

describe('maskTracerFactory', () => {
  it('masks the input, output, metadata, status message and comment of every call, at every depth', () => {
    const recording = new RecordingTracerFactory();
    const tracer = maskTracerFactory(recording, [hideSecret]).createTracer({
      traceId: 't',
      name: 'chat',
      metadata: { note: 'secret' }
    });

    const span = tracer.span({ name: 'span', input: { messages: ['a secret'] }, metadata: { m: 'secret' } });
    span.end({ output: 'secret out', statusMessage: 'failed on secret' });
    span.span({ name: 'child', input: 'secret' }).end({ output: 'secret' });
    span.generation({ name: 'gen', input: 'secret' }).end({ output: 'secret' });
    span.event({ name: 'event', input: 'secret' });
    tracer.generation({ name: 'generation', input: ['secret'], output: 'secret' }).end({ metadata: { x: 'secret' } });
    tracer.event({ name: 'event', output: 'secret' });
    tracer.score({ name: 'score', value: 1, comment: 'secret' });
    tracer.update({ input: 'secret', output: 'secret', metadata: { secret: 'secret' } });
    const child = tracer.withParent('parent');
    child.span({ name: 'nested', input: 'secret' }).end({ output: 'secret' });

    expect(recording.calls.length).toBeGreaterThan(10);
    // Keys are kept; values are masked
    expect(recording.sent.replaceAll('"secret":', '')).not.toContain('secret');
    expect(recording.sent).toContain('[hidden]');
  });

  it('never changes the objects LOFT passes', () => {
    const recording = new RecordingTracerFactory();
    const tracer = maskTracerFactory(recording, [hideSecret]).createTracer({ traceId: 't', name: 'chat' });
    const input = { messages: [{ text: 'secret' }] };

    tracer.span({ name: 'span', input });

    expect(input).toEqual({ messages: [{ text: 'secret' }] });
  });

  it('keeps the ids of spans and generations, and leaves names and other fields alone', () => {
    const recording = new RecordingTracerFactory();
    const tracer = maskTracerFactory(recording, [hideSecret]).createTracer({ traceId: 't', name: 'chat' });

    const span = tracer.span({ name: 'secret-span', level: 'ERROR' });
    const generation = tracer.generation({ name: 'g', model: 'secret-model' });

    expect(span.id).toMatch(/^span-/);
    expect(generation.id).toMatch(/^generation-/);
    expect(recording.calls.at(-2)?.params).toEqual({ name: 'secret-span', level: 'ERROR' });
    expect(recording.calls.at(-1)?.params).toEqual({ name: 'g', model: 'secret-model' });
  });

  it('applies the masks of several middleware in order, and returns the factory itself when none has one', () => {
    const recording = new RecordingTracerFactory();
    const second: LoftMiddleware = { name: 'second', maskTrace: (text) => text.replaceAll('[hidden]', '[x]') };

    maskTracerFactory(recording, [hideSecret, second]).createTracer({ traceId: 't', name: 'c' }).event({
      name: 'e',
      input: 'secret'
    });

    expect(recording.calls.at(-1)?.params).toEqual({ name: 'e', input: '[x]' });
    expect(maskTracerFactory(recording, [{ name: 'no-mask' }])).toBe(recording);
  });

  it('maskTracer wraps a single tracer, such as the one the agents use', () => {
    const recording = new RecordingTracerFactory();

    maskTracer(recording.tracer(), [hideSecret]).update({ output: 'secret' });

    expect(recording.calls).toEqual([{ method: 'update', params: { output: '[hidden]' } }]);
  });
});

describe('maskTracerFactory edge cases (review findings)', () => {
  it('masks the user id and tags of a trace', () => {
    const recording = new RecordingTracerFactory();
    maskTracerFactory(recording, [hideSecret]).createTracer({
      traceId: 't',
      name: 'c',
      userId: 'secret',
      tags: ['secret']
    });
    expect(recording.calls[0].params).toEqual({ traceId: 't', name: 'c', userId: '[hidden]', tags: ['[hidden]'] });
  });

  it('turns a string into [mask failed] when a mask throws, and the call goes on', () => {
    const recording = new RecordingTracerFactory();
    const failing: LoftMiddleware = {
      name: 'failing',
      maskTrace: () => {
        throw new Error('bad detector');
      }
    };

    maskTracerFactory(recording, [failing])
      .createTracer({ traceId: 't', name: 'c' })
      .event({ name: 'e', input: 'raw' });

    expect(recording.calls.at(-1)?.params).toEqual({ name: 'e', input: '[mask failed]' });
  });
});
