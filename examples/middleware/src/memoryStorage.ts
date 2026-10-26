import { randomUUID } from 'node:crypto';

import { Interface, Repository, Strategy, Type } from '@moc-global/loft-definitions';

// Storage kept in memory, so the demo runs without a database. A real application uses the PostgreSQL repositories.

export class MemorySessions implements Repository.Session {
  private readonly sessions = new Map<string, Type.Entity.Session>();

  create(newSession: Type.Entity.CreateSession): Promise<Type.Entity.Session> {
    const now = new Date();
    const session = {
      ...newSession,
      id: randomUUID(),
      ctx: newSession.ctx ?? {},
      externalKey: newSession.externalKey ?? {},
      createdAt: now,
      updatedAt: now
    } as Type.Entity.Session;
    this.sessions.set(session.id, session);
    return Promise.resolve(session);
  }
  getById(id: string): Promise<Type.Entity.Session> {
    const session = this.sessions.get(id);
    return session ? Promise.resolve(session) : Promise.reject(new Error(`Session with id ${id} not found`));
  }
  getByExternalKey(): Promise<Type.Entity.Session> {
    return Promise.reject(new Error('not used'));
  }
  async updateById(id: string, update: Partial<Type.Entity.Session>) {
    const session = { ...(await this.getById(id)), ...update };
    this.sessions.set(id, session);
    return session;
  }
  deleteById(id: string): Promise<void> {
    this.sessions.delete(id);
    return Promise.resolve();
  }
  checkHealth(): Promise<boolean> {
    return Promise.resolve(true);
  }
  // Nothing to close
  end(): Promise<void> {
    return Promise.resolve();
  }
}

export class MemoryChatHistory implements Repository.ChatHistory {
  readonly messages: Type.Entity.Message[] = [];

  addMessages(_sessionId: string, messages: Type.Entity.CreateMessage[]): Promise<Type.Entity.Message[]> {
    const stored = messages.map(
      (message) =>
        ({
          ...message,
          id: message.id ?? randomUUID(),
          sequenceId: String(this.messages.length + 1),
          createdAt: new Date(),
          updatedAt: new Date()
        }) as Type.Entity.Message
    );
    this.messages.push(...stored);
    return Promise.resolve(stored);
  }
  getMessages(sessionId: string): Promise<Type.Entity.Message[]> {
    return Promise.resolve(this.messages.filter((message) => message.sessionId === sessionId));
  }
  checkHealth(): Promise<boolean> {
    return Promise.resolve(true);
  }
  // Nothing to close
  end(): Promise<void> {
    return Promise.resolve();
  }
}

export function constructorOf<T>(instance: T): Interface.BaseComponentConstructor<T> {
  return { initializeContainer: () => undefined, getInstance: () => instance };
}

export function manifestStorage(manifests: unknown) {
  return constructorOf({
    get: () => Promise.resolve(manifests),
    upload: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    checkHealth: () => Promise.resolve(true)
  } as unknown as Repository.ObjectStorage);
}

/** A tracer factory that keeps what it was sent as JSON, standing in for Langfuse. */
export class CollectingTracerFactory implements Strategy.Tracer.TracerFactory {
  readonly sent: string[] = [];

  createTracer(params: Parameters<Strategy.Tracer.TracerFactory['createTracer']>[0]): Strategy.Tracer.Tracer {
    this.keep(params);
    return this.tracer();
  }

  // Nothing is buffered, so there is nothing to send
  shutdownAsync(): Promise<void> {
    return Promise.resolve();
  }

  private keep(params: unknown): void {
    if (params !== undefined) this.sent.push(JSON.stringify(params));
  }

  private tracer(): Strategy.Tracer.Tracer {
    return {
      span: (params) => {
        this.keep(params);
        return this.span();
      },
      generation: (params) => {
        this.keep(params);
        return { id: randomUUID(), end: (end) => this.keep(end) };
      },
      event: (params) => this.keep(params),
      score: (params) => this.keep(params),
      update: (params) => this.keep(params),
      flushAsync: () => Promise.resolve(),
      withParent: () => this.tracer()
    };
  }

  private span(): Strategy.Tracer.Span {
    return {
      id: randomUUID(),
      end: (params) => this.keep(params),
      span: (params) => {
        this.keep(params);
        return this.span();
      },
      generation: (params) => {
        this.keep(params);
        return { id: randomUUID(), end: (end) => this.keep(end) };
      },
      event: (params) => this.keep(params)
    };
  }
}
