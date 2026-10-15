import { Strategy } from '@moc-global/loft-definitions';
import { injectable } from 'inversify';

@injectable()
export class NoOpTracerStrategy implements Strategy.Tracer.TracerFactory {
  createTracer(_params: Parameters<Strategy.Tracer.TracerFactory['createTracer']>[0]): Strategy.Tracer.Tracer {
    return new NoOpTracer();
  }

  async shutdownAsync(): Promise<void> {
    return Promise.resolve();
  }
}

class NoOpTracer implements Strategy.Tracer.Tracer {
  constructor(private fixedParentId?: string) {}

  withParent(parentId: string): Strategy.Tracer.Tracer {
    // Return a new instance with fixed parent ID
    return new NoOpTracer(parentId);
  }

  span(_params: Parameters<Strategy.Tracer.Tracer['span']>[0]): Strategy.Tracer.Span {
    return new NoOpSpan();
  }

  generation(_params: Parameters<Strategy.Tracer.Tracer['generation']>[0]): Strategy.Tracer.Generation {
    return new NoOpGeneration();
  }

  event(_params: Parameters<Strategy.Tracer.Tracer['event']>[0]): void {
    // No-op
  }

  score(_params: Parameters<Strategy.Tracer.Tracer['score']>[0]): void {
    // No-op
  }

  update(_params: Parameters<Strategy.Tracer.Tracer['update']>[0]): void {
    // No-op
  }

  async flushAsync(): Promise<void> {
    return Promise.resolve();
  }
}

class NoOpSpan implements Strategy.Tracer.Span {
  public readonly id: string = 'noop-span';

  end(_params?: Parameters<Strategy.Tracer.Span['end']>[0]): void {
    // No-op
  }

  span(_params: Parameters<Strategy.Tracer.Tracer['span']>[0]): Strategy.Tracer.Span {
    return new NoOpSpan();
  }

  generation(_params: Parameters<Strategy.Tracer.Tracer['generation']>[0]): Strategy.Tracer.Generation {
    return new NoOpGeneration();
  }

  event(_params: Parameters<Strategy.Tracer.Tracer['event']>[0]): void {
    // No-op
  }
}

class NoOpGeneration implements Strategy.Tracer.Generation {
  public readonly id: string = 'noop-generation';

  end(_params?: Parameters<Strategy.Tracer.Generation['end']>[0]): void {
    // No-op
  }
}
