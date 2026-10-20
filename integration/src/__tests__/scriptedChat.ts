import { randomUUID } from 'node:crypto';

import { ChatConfig, ChatConstructor } from '@moc-global/loft';
import { Interface, Strategy, Type } from '@moc-global/loft-definitions';
import { ScriptedLLMStrategy, ScriptedMessage, ScriptedReply } from '@moc-global/loft-test-suite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { expect } from 'vitest';

import type { TestDatabaseInstance } from './initDB';
import { createChatConstructor, createLoftConstructor } from './loftInit';

/** The LLM name the manifest defines for the scripted model (manifest/manifest.json). */
export const SCRIPTED_LLM = 'scripted';

export interface ScriptedChatOptions {
  mcpClients?: Record<string, Client>;
  /** Metadata per MCP client name */
  mcpMetadata?: Record<string, Partial<Interface.MCP.MCPClientMetadata>>;
  tracer?: Strategy.Tracer.TracerFactory;
  /** The fifth `ChatConstructor` argument */
  chatConfig?: ChatConfig;
  /** Runs before the LOFT instance is created, to register middleware, interceptors or computers */
  configure?: (setup: { chatConstructor: ChatConstructor; loftConstructor: LoftConstructorType }) => void;
}

type LoftConstructorType = ReturnType<typeof createLoftConstructor>;

/** A LOFT instance whose only LLM answers from `replies`, with a session on the test-bot manifest. */
export async function startScriptedChat(
  testDb: TestDatabaseInstance,
  replies: ScriptedReply[],
  options: ScriptedChatOptions = {}
) {
  const chatConstructor = createChatConstructor(testDb, options.chatConfig);
  const loftConstructor = createLoftConstructor(chatConstructor, options.tracer);
  const llm = new ScriptedLLMStrategy(SCRIPTED_LLM, replies);
  await loftConstructor.registerLlmStrategy(SCRIPTED_LLM, llm);
  for (const [name, client] of Object.entries(options.mcpClients ?? {})) {
    await chatConstructor.useMcpClient(name, client, options.mcpMetadata?.[name]);
  }
  options.configure?.({ chatConstructor, loftConstructor });

  const loft = loftConstructor.getInstance();
  const session = await loft.chat.createSession({
    currentLlmName: SCRIPTED_LLM,
    currentManifestName: 'test-bot',
    ctx: {}
  });
  return { loft, loftConstructor, chatConstructor, llm, session };
}

export function userMessage(text: string, sessionId: string): Type.Entity.CreateMessage {
  return {
    id: randomUUID(),
    sessionId,
    ctx: {},
    llmName: SCRIPTED_LLM,
    manifestName: 'test-bot',
    content: [{ type: 'text', text }],
    role: Type.LLM.UnifiedMessageRole.user,
    author: 'user',
    llmIgnore: false
  };
}

type ToolCallPart = Extract<Type.Entity.FullContentPart, { type: 'tool_call' }>;
type ToolResultPart = Extract<Type.Entity.FullContentPart, { type: 'tool_result' }>;

export const toolCallsIn = (messages: Pick<Type.Entity.Message, 'content'>[]): ToolCallPart[] =>
  messages.flatMap((m) => m.content.filter((part): part is ToolCallPart => part.type === 'tool_call'));

export const toolResultsIn = (messages: Pick<Type.Entity.Message, 'content'>[]): ToolResultPart[] =>
  messages.flatMap((m) => m.content.filter((part): part is ToolResultPart => part.type === 'tool_result'));

export const textOf = (part: ToolResultPart | Pick<Type.Entity.Message, 'content'>): string =>
  part.content.map((item) => (item.type === 'text' ? item.text : '')).join('');

/** A message as tests compare it: role plus text, tool calls and tool results. */
export const summarize = (message: Pick<Type.Entity.Message, 'role' | 'content'>) => ({
  role: message.role,
  text: textOf(message),
  toolCalls: toolCallsIn([message]).map((call) => ({ name: call.params.name, arguments: call.params.arguments })),
  toolResults: toolResultsIn([message]).map((result) => ({ text: textOf(result), isError: result.isError ?? false }))
});

/** Every tool result answers an earlier tool call in the window, and every tool call has exactly one result. */
export function expectIntactToolChain(messages: ScriptedMessage[]) {
  const pending = new Set<string>();
  for (const message of messages) {
    for (const call of message.toolCalls) {
      expect(call.callId, 'a tool call without an id').toBeDefined();
      pending.add(call.callId!);
    }
    for (const result of message.toolResults) {
      expect(pending.has(result.callId!), `tool result ${result.callId} has no tool call before it`).toBe(true);
      pending.delete(result.callId!);
    }
  }
  expect([...pending], 'tool calls without a result').toEqual([]);
}
