export interface TracerFactory {
  createTracer(params: {
    traceId: string;
    name: string;
    userId?: string;
    sessionId?: string;
    metadata?: Record<string, any>;
    tags?: string[];
  }): Tracer;

  shutdownAsync(): Promise<void>;
}

export interface Tracer {
  span(params: {
    name: string;
    input?: any;
    output?: any;
    metadata?: Record<string, any>;
    level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
    statusMessage?: string;
    parentId?: string;
    startTime?: Date;
    endTime?: Date;
  }): Span;

  generation(params: {
    name: string;
    model?: string;
    modelParameters?: Record<string, any>;
    input?: any;
    output?: any;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      cost?: number;
    };
    metadata?: Record<string, any>;
    parentId?: string;
    startTime?: Date;
    endTime?: Date;
  }): Generation;

  event(params: {
    name: string;
    input?: any;
    output?: any;
    metadata?: Record<string, any>;
    level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
    parentId?: string;
    timestamp?: Date;
  }): void;

  score(params: {
    name: string;
    value: number;
    comment?: string;
    dataType?: 'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN';
    timestamp?: Date;
  }): void;

  update(params: { input?: any; output?: any; metadata?: Record<string, any>; tags?: string[] }): void;

  flushAsync(): Promise<void>;

  /**
   * Creates a wrapper of this tracer with a fixed parent ID for all operations.
   * This is useful for creating nested contexts where all spans should be children of a specific parent.
   *
   * @param parentId - The parent observation ID that all spans created by this tracer should use
   * @returns A new tracer instance that uses the same underlying trace but with fixed parent context
   */
  withParent(parentId: string): Tracer;
}

export interface Span {
  readonly id: string;

  end(params?: {
    output?: any;
    metadata?: Record<string, any>;
    level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
    statusMessage?: string;
    endTime?: Date;
  }): void;

  span(params: Parameters<Tracer['span']>[0]): Span;
  generation(params: Parameters<Tracer['generation']>[0]): Generation;
  event(params: Parameters<Tracer['event']>[0]): void;
}

export interface Generation {
  readonly id: string;

  end(params?: {
    output?: any;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      cost?: number;
    };
    metadata?: Record<string, any>;
    level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
    statusMessage?: string;
    endTime?: Date;
  }): void;
}
