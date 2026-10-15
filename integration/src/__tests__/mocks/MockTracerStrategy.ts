import { Strategy } from '@moc-global/loft-definitions';

export interface TracerEvent {
  type:
    | 'createTracer'
    | 'span'
    | 'generation'
    | 'event'
    | 'score'
    | 'update'
    | 'flushAsync'
    | 'shutdownAsync'
    | 'spanEnd'
    | 'generationEnd';
  timestamp: Date;
  data?: any;
  traceId?: string;
  spanId?: string;
  /** For spans and generations: the id the tracer was given with withParent(), if any */
  parentId?: string;
}

export class MockTracerStrategy implements Strategy.Tracer.TracerFactory {
  public events: TracerEvent[] = [];
  public createTracerCalls = 0;
  public shutdownAsyncCalls = 0;
  public flushAsyncCalls = 0;
  private tracers: Map<string, MockTracerInstance> = new Map();
  private idCounter = 0;

  /** Ids are unique across all tracers, including those made with withParent() */
  nextId(kind: 'span' | 'generation'): string {
    return `${kind}-${++this.idCounter}`;
  }

  createTracer(params: Parameters<Strategy.Tracer.TracerFactory['createTracer']>[0]): Strategy.Tracer.Tracer {
    this.createTracerCalls++;
    this.events.push({
      type: 'createTracer',
      timestamp: new Date(),
      data: params,
      traceId: params.traceId
    });

    const tracer = new MockTracerInstance(params.traceId, this);
    this.tracers.set(params.traceId, tracer);
    return tracer;
  }

  async shutdownAsync(): Promise<void> {
    this.shutdownAsyncCalls++;
    this.events.push({
      type: 'shutdownAsync',
      timestamp: new Date()
    });
    return Promise.resolve();
  }

  getTracer(traceId: string): MockTracerInstance | undefined {
    return this.tracers.get(traceId);
  }

  reset(): void {
    this.idCounter = 0;
    this.events = [];
    this.createTracerCalls = 0;
    this.shutdownAsyncCalls = 0;
    this.flushAsyncCalls = 0;
    this.tracers.clear();
  }
}

export class MockTracerInstance implements Strategy.Tracer.Tracer {
  public spans: Map<string, MockSpanInstance> = new Map();
  public generations: Map<string, MockGenerationInstance> = new Map();

  constructor(
    private traceId: string,
    private strategy: MockTracerStrategy,
    private parentId?: string
  ) {}

  withParent(parentId: string): Strategy.Tracer.Tracer {
    return new MockTracerInstance(this.traceId, this.strategy, parentId);
  }

  span(params: Parameters<Strategy.Tracer.Tracer['span']>[0]): Strategy.Tracer.Span {
    const spanId = this.strategy.nextId('span');
    this.strategy.events.push({
      type: 'span',
      timestamp: new Date(),
      data: params,
      traceId: this.traceId,
      spanId,
      parentId: this.parentId
    });

    const span = new MockSpanInstance(spanId, this.traceId, this.strategy);
    this.spans.set(spanId, span);
    return span;
  }

  generation(params: Parameters<Strategy.Tracer.Tracer['generation']>[0]): Strategy.Tracer.Generation {
    const generationId = this.strategy.nextId('generation');
    this.strategy.events.push({
      type: 'generation',
      timestamp: new Date(),
      data: params,
      traceId: this.traceId,
      spanId: generationId,
      parentId: this.parentId
    });

    const generation = new MockGenerationInstance(generationId, this.traceId, this.strategy);
    this.generations.set(generationId, generation);
    return generation;
  }

  event(params: Parameters<Strategy.Tracer.Tracer['event']>[0]): void {
    this.strategy.events.push({
      type: 'event',
      timestamp: new Date(),
      data: params,
      traceId: this.traceId
    });
  }

  score(params: Parameters<Strategy.Tracer.Tracer['score']>[0]): void {
    this.strategy.events.push({
      type: 'score',
      timestamp: new Date(),
      data: params,
      traceId: this.traceId
    });
  }

  update(params: Parameters<Strategy.Tracer.Tracer['update']>[0]): void {
    this.strategy.events.push({
      type: 'update',
      timestamp: new Date(),
      data: params,
      traceId: this.traceId
    });
  }

  async flushAsync(): Promise<void> {
    this.strategy.flushAsyncCalls++;
    this.strategy.events.push({
      type: 'flushAsync',
      timestamp: new Date(),
      traceId: this.traceId
    });
    return Promise.resolve();
  }
}

export class MockSpanInstance implements Strategy.Tracer.Span {
  public readonly id: string;
  public ended = false;

  constructor(
    spanId: string,
    private traceId: string,
    private strategy: MockTracerStrategy
  ) {
    this.id = spanId;
  }

  end(params?: Parameters<Strategy.Tracer.Span['end']>[0]): void {
    this.ended = true;
    this.strategy.events.push({
      type: 'spanEnd',
      timestamp: new Date(),
      data: params,
      traceId: this.traceId,
      spanId: this.id
    });
  }

  span(params: Parameters<Strategy.Tracer.Tracer['span']>[0]): Strategy.Tracer.Span {
    const spanId = `${this.id}-child-${Date.now()}`;
    this.strategy.events.push({
      type: 'span',
      timestamp: new Date(),
      data: { ...params, parentSpanId: this.id },
      traceId: this.traceId,
      spanId
    });
    return new MockSpanInstance(spanId, this.traceId, this.strategy);
  }

  generation(params: Parameters<Strategy.Tracer.Tracer['generation']>[0]): Strategy.Tracer.Generation {
    const generationId = `${this.id}-generation-${Date.now()}`;
    this.strategy.events.push({
      type: 'generation',
      timestamp: new Date(),
      data: { ...params, parentSpanId: this.id },
      traceId: this.traceId,
      spanId: generationId
    });
    return new MockGenerationInstance(generationId, this.traceId, this.strategy);
  }

  event(params: Parameters<Strategy.Tracer.Tracer['event']>[0]): void {
    this.strategy.events.push({
      type: 'event',
      timestamp: new Date(),
      data: { ...params, parentSpanId: this.id },
      traceId: this.traceId,
      spanId: this.id
    });
  }
}

export class MockGenerationInstance implements Strategy.Tracer.Generation {
  public readonly id: string;
  public ended = false;

  constructor(
    generationId: string,
    private traceId: string,
    private strategy: MockTracerStrategy
  ) {
    this.id = generationId;
  }

  end(params?: Parameters<Strategy.Tracer.Generation['end']>[0]): void {
    this.ended = true;
    this.strategy.events.push({
      type: 'generationEnd',
      timestamp: new Date(),
      data: params,
      traceId: this.traceId,
      spanId: this.id
    });
  }
}
