import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { ChatConstructor, LoftConstructor, ManifestManagerConstructor } from '@moc-global/loft';
import { Chat, Interface, Repository, Strategy, Type } from '@moc-global/loft-definitions';
import { configureSpyLoggerStrategy, ScriptedLLMStrategy, type ScriptedReply } from '@moc-global/loft-test-suite';
import { vi } from 'vitest';

export const LLM = 'scripted';
export const MANIFEST = 'assistant';

const MANIFESTS = {
  llmManifests: { [MANIFEST]: { [LLM]: { systemMessage: 'You help.', modelPreset: { model: 'scripted' } } } },
  prompts: {},
  aiTasks: {}
};

// Storage kept in memory, so the whole chat runs without a database
class MemorySessions implements Repository.Session {
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

function constructorOf<T>(instance: T): Interface.BaseComponentConstructor<T> {
  return { initializeContainer: () => undefined, getInstance: () => instance };
}

const manifestStorage = constructorOf({
  get: async () => MANIFESTS,
  upload: async () => undefined,
  remove: async () => undefined,
  checkHealth: async () => true
} as unknown as Repository.ObjectStorage);

/** A LOFT with in-memory storage, the scripted model, the given tracer factory and a logger that records every call. */
export async function buildLoft(replies: ScriptedReply[], tracer: Strategy.Tracer.TracerFactory) {
  const logger = configureSpyLoggerStrategy();
  const history = new MemoryChatHistory();
  const chatConstructor = new ChatConstructor(
    constructorOf<Repository.Session>(new MemorySessions()),
    constructorOf<Repository.ChatHistory>(history)
  );
  const loftConstructor = new LoftConstructor<Chat.ChatInterface>(
    { logLevel: Interface.LogLevel.TRACE },
    new ManifestManagerConstructor(manifestStorage, {
      manifestPath: 'manifest.json',
      errorPath: 'errors.json',
      cacheExpirationTime: 60_000
    }),
    chatConstructor,
    tracer,
    logger
  );
  const llm = new ScriptedLLMStrategy(LLM, replies);
  await loftConstructor.registerLlmStrategy(LLM, llm);
  loftConstructor.registerGMComputer(MANIFEST, LLM, async (_ctx, prompt) => prompt.content);
  return {
    chatConstructor,
    loftConstructor,
    llm,
    history,
    /** Everything the logger was given at the given levels, all by default, as one JSON text */
    logged: (levels: readonly (keyof typeof logger)[] = Object.keys(logger) as (keyof typeof logger)[]) =>
      JSON.stringify(levels.flatMap((level) => vi.mocked(logger[level]).mock.calls))
  };
}

export function userMessage(text: string, sessionId: string): Type.Entity.CreateMessage {
  return {
    sessionId,
    ctx: {},
    content: [{ type: 'text', text }],
    role: Type.LLM.UnifiedMessageRole.user,
    author: 'user',
    llmName: LLM,
    manifestName: MANIFEST,
    llmIgnore: false
  };
}
