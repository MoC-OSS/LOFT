import type { Strategy } from '@moc-global/loft-definitions';

type Tracer = Strategy.Tracer.Tracer;
type Span = Strategy.Tracer.Span;
type Generation = Strategy.Tracer.Generation;

/** One call a tracer received: the method and its argument. */
export interface TraceCall {
  method: string;
  params: unknown;
}

/** A tracer factory that records every call of its tracers, spans and generations, as a trace vendor would receive them. */
export class RecordingTracerFactory implements Strategy.Tracer.TracerFactory {
  readonly calls: TraceCall[] = [];
  private nextId = 0;

  createTracer(params: Parameters<Strategy.Tracer.TracerFactory['createTracer']>[0]): Tracer {
    this.record('createTracer', params);
    return this.tracer();
  }

  async shutdownAsync(): Promise<void> {}

  /** Everything the tracers received, as one JSON text. */
  get sent(): string {
    return JSON.stringify(this.calls);
  }

  record(method: string, params: unknown): void {
    // A copy, as a vendor client serializes what it is given
    this.calls.push({ method, params: params === undefined ? undefined : JSON.parse(JSON.stringify(params)) });
  }

  tracer(): Tracer {
    return {
      span: (params) => {
        this.record('span', params);
        return this.span();
      },
      generation: (params) => {
        this.record('generation', params);
        return this.generation();
      },
      event: (params) => this.record('event', params),
      score: (params) => this.record('score', params),
      update: (params) => this.record('update', params),
      flushAsync: async () => undefined,
      withParent: () => this.tracer()
    };
  }

  private span(): Span {
    const id = `span-${++this.nextId}`;
    return {
      id,
      end: (params) => this.record('span.end', params),
      span: (params) => {
        this.record('span.span', params);
        return this.span();
      },
      generation: (params) => {
        this.record('span.generation', params);
        return this.generation();
      },
      event: (params) => this.record('span.event', params)
    };
  }

  private generation(): Generation {
    const id = `generation-${++this.nextId}`;
    return { id, end: (params) => this.record('generation.end', params) };
  }
}
