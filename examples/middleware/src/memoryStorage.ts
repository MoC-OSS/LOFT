import { randomUUID } from 'node:crypto';

import { Interface, Repository, Strategy, Type } from '@moc-global/loft-definitions';

// Storage kept in memory, so the demo runs without a database. A real application uses the PostgreSQL repositories.

export class MemorySessions implements Repository.Session {
  private readonly sessions = new Map<string, Type.Entity.Session>();

  async create(newSession: Type.Entity.CreateSession): Promise<Type.Entity.Session> {
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
    return session;
  }
  async getById(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session with id ${id} not found`);
    return session;
  }
  async getByExternalKey(): Promise<Type.Entity.Session> {
    throw new Error('not used');
  }
  async updateById(id: string, update: Partial<Type.Entity.Session>) {
    const session = { ...(await this.getById(id)), ...update };
    this.sessions.set(id, session);
    return session;
  }
  async deleteById(id: string) {
    this.sessions.delete(id);
  }
  async checkHealth() {
    return true;
  }
  async end() {}
}

export class MemoryChatHistory implements Repository.ChatHistory {
  readonly messages: Type.Entity.Message[] = [];

  async addMessages(_sessionId: string, messages: Type.Entity.CreateMessage[]) {
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
    return stored;
  }
  async getMessages(sessionId: string) {
    return this.messages.filter((message) => message.sessionId === sessionId);
  }
  async checkHealth() {
    return true;
  }
  async end() {}
}

export function constructorOf<T>(instance: T): Interface.BaseComponentConstructor<T> {
  return { initializeContainer: () => undefined, getInstance: () => instance };
}

export function manifestStorage(manifests: unknown) {
  return constructorOf({
    get: async () => manifests,
    upload: async () => undefined,
    remove: async () => undefined,
    checkHealth: async () => true
  } as unknown as Repository.ObjectStorage);
}

/** A tracer factory that keeps what it was sent as JSON, standing in for Langfuse. */
export class CollectingTracerFactory implements Strategy.Tracer.TracerFactory {
  readonly sent: string[] = [];

  createTracer(params: Parameters<Strategy.Tracer.TracerFactory['createTracer']>[0]): Strategy.Tracer.Tracer {
    this.keep(params);
    return this.tracer();
  }

  async shutdownAsync(): Promise<void> {}

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
      flushAsync: async () => undefined,
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
