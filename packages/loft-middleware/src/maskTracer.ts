import type { Strategy } from '@moc-global/loft-definitions';

import { mapStrings, type TextMap } from './content';
import type { LoftMiddleware } from './types';

type Tracer = Strategy.Tracer.Tracer;
type TracerFactory = Strategy.Tracer.TracerFactory;
type Span = Strategy.Tracer.Span;
type Generation = Strategy.Tracer.Generation;

// The fields of a tracer call that can carry conversation data or the user's identity
const MASKED_FIELDS = ['input', 'output', 'metadata', 'statusMessage', 'comment', 'userId', 'tags'] as const;
/** What a string becomes when a mask throws: the trace loses it, the chat goes on. */
export const MASK_FAILED_TEXT = '[mask failed]';

/** The middleware's trace masks, applied in order, or undefined when none has one. */
export function traceMaskOf(middleware: readonly LoftMiddleware[]): TextMap | undefined {
  const masks = middleware.flatMap((item) => (item.maskTrace ? [item.maskTrace] : []));
  if (masks.length === 0) return undefined;
  return (text) => {
    try {
      return masks.reduce((masked, mask) => mask(masked), text);
    } catch {
      return MASK_FAILED_TEXT;
    }
  };
}

function masked<T extends object>(params: T, mask: TextMap): T;
function masked<T extends object>(params: T | undefined, mask: TextMap): T | undefined;
function masked<T extends object>(params: T | undefined, mask: TextMap): T | undefined {
  if (!params) return params;
  const copy = { ...params } as Record<string, unknown>;
  for (const field of MASKED_FIELDS) {
    if (copy[field] !== undefined) copy[field] = mapStrings(copy[field], mask);
  }
  return copy as T;
}

function maskGeneration(generation: Generation, mask: TextMap): Generation {
  return {
    get id() {
      return generation.id;
    },
    end: (params) => generation.end(masked(params, mask))
  };
}

function maskSpan(span: Span, mask: TextMap): Span {
  return {
    get id() {
      return span.id;
    },
    end: (params) => span.end(masked(params, mask)),
    span: (params) => maskSpan(span.span(masked(params, mask)), mask),
    generation: (params) => maskGeneration(span.generation(masked(params, mask)), mask),
    event: (params) => span.event(masked(params, mask))
  };
}

// The middleware whose masks each tracer applies, including those of a masked tracer it wraps
const masksOf = new WeakMap<Tracer, readonly LoftMiddleware[]>();

/** Whether the tracer applies the middleware's `maskTrace`. */
export function masksTraceOf(tracer: Tracer, middleware: LoftMiddleware): boolean {
  return masksOf.get(tracer)?.includes(middleware) ?? false;
}

function maskWith(tracer: Tracer, mask: TextMap, middleware: readonly LoftMiddleware[]): Tracer {
  const wrapped: Tracer = {
    span: (params) => maskSpan(tracer.span(masked(params, mask)), mask),
    generation: (params) => maskGeneration(tracer.generation(masked(params, mask)), mask),
    event: (params) => tracer.event(masked(params, mask)),
    score: (params) => tracer.score(masked(params, mask)),
    update: (params) => tracer.update(masked(params, mask)),
    flushAsync: () => tracer.flushAsync(),
    withParent: (parentId) => maskWith(tracer.withParent(parentId), mask, middleware)
  };
  masksOf.set(wrapped, [...middleware, ...(masksOf.get(tracer) ?? [])]);
  return wrapped;
}

/**
 * A tracer that applies the middleware's `maskTrace` to every string it sends: the input, output, metadata, status
 * message, comment, user id and tags of every trace, span, generation, event and score, including those of child
 * tracers. Names, model names and model parameters are not masked. A mask that throws turns the string into
 * `[mask failed]`. The values LOFT passes are copied, never changed. Use it for a tracer that does not come from a
 * factory, such as the one given to the agents' `OrchestratorBuilder.setTracer`.
 */
export function maskTracer(tracer: Tracer, middleware: readonly LoftMiddleware[]): Tracer {
  const mask = traceMaskOf(middleware);
  return mask ? maskWith(tracer, mask, middleware) : tracer;
}

/**
 * A tracer factory whose tracers apply the middleware's `maskTrace`, see `maskTracer`. Pass it to `LoftConstructor`
 * in place of the factory it wraps.
 */
export function maskTracerFactory(factory: TracerFactory, middleware: readonly LoftMiddleware[]): TracerFactory {
  const mask = traceMaskOf(middleware);
  if (!mask) return factory;
  return {
    createTracer: (params) => maskWith(factory.createTracer(masked(params, mask)), mask, middleware),
    shutdownAsync: () => factory.shutdownAsync()
  };
}
