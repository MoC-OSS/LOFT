import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { Chat, Interface, Repository, Strategy, Type } from '@moc-global/loft-definitions';
import { ScriptedLLMStrategy } from '@moc-global/loft-test-suite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { FsRepository } from '../../../base-components';
import {
  ChatConstructor,
  FsRepositoryConstructor,
  LoftConstructor,
  ManifestManagerConstructor
} from '../../../constructors';
import { ChatConfig } from '../../../types';

const LLM = 'scripted';
const MANIFEST = 'assistant';
const MANIFESTS = {
  llmManifests: { [MANIFEST]: { [LLM]: { systemMessage: 'You are {{role}}.', modelPreset: { model: 'scripted' } } } },
  prompts: {},
  aiTasks: {}
};

// Storage kept in memory, so the constructors are tested without a database
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

class MemoryChatHistory implements Repository.ChatHistory {
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

const manifestStorage = (manifests: unknown) =>
  constructorOf({
    get: async () => manifests,
    upload: async () => undefined,
    remove: async () => undefined,
    checkHealth: async () => true
  } as unknown as Repository.ObjectStorage);

function build(
  options: { manifests?: unknown; chatConfig?: ChatConfig; cropper?: Strategy.LlmContextWindowCropper } = {}
) {
  const history = new MemoryChatHistory();
  const chatConstructor = new ChatConstructor(
    constructorOf<Repository.Session>(new MemorySessions()),
    constructorOf<Repository.ChatHistory>(history),
    undefined,
    options.cropper,
    options.chatConfig
  );
  const tracer = { createTracer: vi.fn(), shutdownAsync: vi.fn().mockResolvedValue(undefined) };
  const loftConstructor = new LoftConstructor<Chat.ChatInterface>(
    { logLevel: Interface.LogLevel.NONE },
    new ManifestManagerConstructor(manifestStorage(options.manifests ?? MANIFESTS), {
      manifestPath: 'manifest.json',
      errorPath: 'errors.json',
      cacheExpirationTime: 60_000
    }),
    chatConstructor
  );
  return { chatConstructor, loftConstructor, history, tracer };
}

function userMessage(text: string, sessionId: string): Type.Entity.CreateMessage {
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

async function calculatorClient() {
  const server = new McpServer({ name: 'calculator', version: '1.0.0' });
  server.tool('add', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
    content: [{ type: 'text', text: String(a + b) }]
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

describe('LoftConstructor and ChatConstructor', () => {
  it('build a LOFT that answers through the registered LLM, middleware and computers', async () => {
    const { chatConstructor, loftConstructor, history } = build();
    const llm = new ScriptedLLMStrategy(LLM, [{ text: 'Hi there.' }]);
    await loftConstructor.registerLlmStrategy(LLM, llm);
    const steps: string[] = [];
    chatConstructor.registerInputMiddleware('input', async (_ctx, payload, chain) => {
      steps.push('input');
      chain.next();
      return payload;
    });
    chatConstructor.registerBeforeGenerateMiddleware('before', async (_ctx, payload, chain) => {
      steps.push('before');
      chain.next();
      return payload;
    });
    chatConstructor.registerAfterGenerateMiddleware('after', async (_ctx, payload, chain) => {
      steps.push('after');
      chain.next();
      return payload;
    });
    loftConstructor.registerGMComputer(MANIFEST, LLM, async (_ctx, prompt) =>
      prompt.content.replace('{{role}}', 'a helpful assistant')
    );
    loftConstructor.registerATMComputer(MANIFEST, LLM, async (_ctx, prompt) => prompt.content);
    loftConstructor.registerPromptComputer('greeting', LLM, async (_ctx, prompt) => prompt.content);
    await loftConstructor.validateManifest();
    const loft = loftConstructor.getInstance();
    const session = await loft.chat.createSession({ currentLlmName: LLM, currentManifestName: MANIFEST, ctx: {} });

    await loft.chat.addMessages(session.id, [], [userMessage('Hello', session.id)]);
    const result = await loft.chat.generate({ sessionId: session.id });

    expect(result.messages.llmResponse.topChoice.content).toEqual([{ type: 'text', text: 'Hi there.' }]);
    expect(llm.calls[0].systemMessage).toBe('You are a helpful assistant.');
    expect(llm.calls[0].messages.map((message) => message.text)).toEqual(['Hello']);
    expect(steps).toEqual(['input', 'input', 'before', 'after']);
    expect(history.messages.map((message) => message.role)).toEqual(['user']);
    await loft.shutdown();
  });

  it('give the model the tools of an MCP client and run the tool calls', async () => {
    const { chatConstructor, loftConstructor } = build();
    const llm = new ScriptedLLMStrategy(LLM, [
      { toolCalls: [{ name: 'add', arguments: { a: 2, b: 2 } }] },
      { text: 'It is 4.' }
    ]);
    await loftConstructor.registerLlmStrategy(LLM, llm);
    await chatConstructor.useMcpClient('calculator', await calculatorClient());
    const intercepted = vi.fn<Interface.ToolInterceptor>(async ({ toolRequest, executeToolFn }) =>
      executeToolFn({ params: { name: toolRequest.params.name, arguments: toolRequest.params.arguments } })
    );
    chatConstructor.registerToolInterceptor('add', intercepted);
    const loft = loftConstructor.getInstance();
    const session = await loft.chat.createSession({ currentLlmName: LLM, currentManifestName: MANIFEST, ctx: {} });

    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('2 + 2?', session.id)]
    });

    expect(llm.calls[0].toolNames).toContain('add');
    expect(llm.calls[1].messages.at(-1)?.toolResults[0].text).toBe('4');
    expect(intercepted).toHaveBeenCalled();
    expect(result.messages.llmResponse.topChoice.content).toEqual([{ type: 'text', text: 'It is 4.' }]);
    await loft.shutdown();
  });

  it('use the context window cropper and the chat config given to the chat constructor', async () => {
    const crop = vi.fn((messages: unknown[]) => messages.slice(-1));
    const { loftConstructor } = build({
      cropper: { crop } as unknown as Strategy.LlmContextWindowCropper,
      chatConfig: { mcp: { toolCacheTtl: 1000 } }
    });
    const llm = new ScriptedLLMStrategy(LLM, [{ text: 'Short.' }]);
    await loftConstructor.registerLlmStrategy(LLM, llm);
    const loft = loftConstructor.getInstance();
    const session = await loft.chat.createSession({ currentLlmName: LLM, currentManifestName: MANIFEST, ctx: {} });
    await loft.chat.addMessages(session.id, [], [userMessage('first', session.id), userMessage('second', session.id)]);

    await loft.chat.generate({ sessionId: session.id, llmContextWindow: 1 });

    expect(crop).toHaveBeenCalled();
    expect(llm.calls[0].messages.map((message) => message.text)).toEqual(['second']);
    await loft.shutdown();
  });

  it('reject an invalid manifest on validateManifest()', async () => {
    const { loftConstructor } = build({ manifests: { llmManifests: 'not an object' } });

    await expect(loftConstructor.validateManifest()).rejects.toThrow();
  });

  it('shut the tracer down on gracefulShutdown()', async () => {
    const shutdownAsync = vi.fn().mockResolvedValue(undefined);
    const loftConstructor = new LoftConstructor<Chat.ChatInterface>(
      { logLevel: Interface.LogLevel.NONE },
      new ManifestManagerConstructor(manifestStorage(MANIFESTS), {
        manifestPath: 'manifest.json',
        errorPath: 'errors.json',
        cacheExpirationTime: 60_000
      }),
      undefined,
      { createTracer: vi.fn(), shutdownAsync } as unknown as Strategy.Tracer.TracerFactory
    );

    await loftConstructor.gracefulShutdown();

    expect(shutdownAsync).toHaveBeenCalledTimes(1);
  });

  it('log a tracer that fails to shut down instead of throwing', async () => {
    const loftConstructor = new LoftConstructor<Chat.ChatInterface>(
      { logLevel: Interface.LogLevel.NONE },
      new ManifestManagerConstructor(manifestStorage(MANIFESTS), {
        manifestPath: 'manifest.json',
        errorPath: 'errors.json',
        cacheExpirationTime: 60_000
      }),
      undefined,
      {
        createTracer: vi.fn(),
        shutdownAsync: vi.fn().mockRejectedValue(new Error('down'))
      } as unknown as Strategy.Tracer.TracerFactory
    );

    await expect(loftConstructor.gracefulShutdown()).resolves.toBeUndefined();
  });
});

describe('FsRepositoryConstructor', () => {
  let directory: string | undefined;

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('gives a file repository that reads manifests relative to the working directory', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'loft-fs-'));
    const file = path.join(directory, 'manifest.json');
    await writeFile(file, JSON.stringify(MANIFESTS));
    const constructor = new FsRepositoryConstructor();
    constructor.initializeContainer(new (await import('inversify')).Container());

    const repository = constructor.getInstance();

    expect(repository).toBeInstanceOf(FsRepository);
    await expect(repository.get(path.relative(process.cwd(), file))).resolves.toEqual(MANIFESTS);
  });
});
