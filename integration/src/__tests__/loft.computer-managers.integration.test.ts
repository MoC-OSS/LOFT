import 'reflect-metadata';

import { Type } from '@moc-global/loft-definitions';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDB, type TestDatabaseInstance } from './initDB';
import { InitClientServer } from './mcpClientServerInMemory';
import { SCRIPTED_LLM, startScriptedChat, summarize, toolResultsIn, userMessage } from './scriptedChat';

const { user, assistant, tool } = Type.LLM.UnifiedMessageRole;

const systemMessage = (value: string) =>
  `You are a test assistant. For any input, respond with exactly:\n'${value}'\n\nDo not add any other text or modifications.`;

describe('Prompt computers and MCP tools', () => {
  let testDb: TestDatabaseInstance;

  beforeAll(async () => {
    testDb = await initDB();
  });

  afterAll(async () => {
    await testDb?.close();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  it('runs the prompt, AI task and generate-manifest computers from middleware', async () => {
    let prompt = '';
    let aiTaskAnswer = '';
    const { loft, llm, session } = await startScriptedChat(
      testDb,
      [{ text: 'AI task answer' }, { text: 'Final answer' }],
      {
        configure: ({ chatConstructor, loftConstructor }) => {
          loftConstructor.registerPromptComputer('test-prompt', SCRIPTED_LLM, async (_ctx, p) =>
            p.content.replaceAll('{{valueToReturn}}', 'from the prompt computer')
          );
          loftConstructor.registerGMComputer('test-bot', SCRIPTED_LLM, async (_ctx, p) =>
            p.content.replaceAll('{{valueToReturn}}', 'from the GM computer')
          );
          loftConstructor.registerATMComputer('test-placeholder-ai-task', SCRIPTED_LLM, async (_ctx, p) =>
            p.content.replaceAll('{{valueToReturn}}', 'from the ATM computer')
          );
          chatConstructor.registerBeforeGenerateMiddleware('use-computers', async (ctx, payload, chain) => {
            prompt = await ctx.getPrompt('test-prompt', SCRIPTED_LLM);
            const task = await ctx.aiTask(SCRIPTED_LLM, 'test-placeholder-ai-task', 'Classify this');
            aiTaskAnswer = summarize(task.topChoice).text;
            await ctx.session.update({ ctx: { classified: true } });
            chain.next();
            return payload;
          });
        }
      }
    );

    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('Hello', session.id)]
    });

    expect(prompt).toBe(systemMessage('from the prompt computer'));
    // The AI task is one model call with the computed system message and the task content
    expect(llm.calls[0].systemMessage).toBe(systemMessage('from the ATM computer'));
    expect(llm.calls[0].messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: user, text: 'Classify this' }
    ]);
    expect(aiTaskAnswer).toBe('AI task answer');
    // generate() uses the generate-manifest computer's system message
    expect(llm.calls[1].systemMessage).toBe(systemMessage('from the GM computer'));
    expect(llm.calls[1].messages.map(({ role, text }) => ({ role, text }))).toEqual([{ role: user, text: 'Hello' }]);
    expect(summarize(result.messages.llmResponse.topChoice).text).toBe('Final answer');
    expect((await loft.chat.getSessionById(session.id)).ctx).toEqual({ classified: true });
  });

  it('runs a sequence of MCP tool calls and stores the whole chain', async () => {
    const { loft, llm, session } = await startScriptedChat(
      testDb,
      [
        { toolCalls: [{ name: 'add', arguments: { a: 2, b: 2 } }] },
        { toolCalls: [{ name: 'multiply', arguments: { a: 4, b: 3 } }] },
        { text: 'The result is 12.' }
      ],
      { mcpClients: { calculator: await InitClientServer() } }
    );

    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('Calculate 2+2 and multiply the result by 3', session.id)]
    });
    await result.messages.save();

    // Every MCP tool is offered to the model
    expect(llm.calls[0].toolNames).toEqual(expect.arrayContaining(['add', 'subtract', 'multiply', 'divide']));
    expect((result.messages.llmResponse.usedTools ?? []).map(summarize)).toEqual([
      { role: assistant, text: '', toolCalls: [{ name: 'add', arguments: { a: 2, b: 2 } }], toolResults: [] },
      { role: tool, text: '', toolCalls: [], toolResults: [{ text: '4', isError: false }] },
      { role: assistant, text: '', toolCalls: [{ name: 'multiply', arguments: { a: 4, b: 3 } }], toolResults: [] },
      { role: tool, text: '', toolCalls: [], toolResults: [{ text: '12', isError: false }] }
    ]);
    // The third call saw both results
    expect(llm.calls[2].messages.flatMap((message) => message.toolResults.map(({ text }) => text))).toEqual([
      '4',
      '12'
    ]);

    const history = await loft.chat.getChatHistory(session.id);
    expect(history.map((message) => message.role)).toEqual([user, assistant, tool, assistant, tool, assistant]);
    expect(summarize(history.at(-1)!).text).toBe('The result is 12.');
  });

  it('runs a tool offered by two MCP clients on both and returns both results', async () => {
    const { loft, session } = await startScriptedChat(
      testDb,
      [{ toolCalls: [{ name: 'add', arguments: { a: 2, b: 2 } }] }, { text: '4' }],
      { mcpClients: { calculator: await InitClientServer(), calculator2: await InitClientServer() } }
    );

    const result = await loft.chat.generate({
      sessionId: session.id,
      directMessages: [userMessage('What is 2 + 2?', session.id)]
    });

    // One tool result holding each client's content
    const [toolResult] = toolResultsIn(result.messages.llmResponse.usedTools ?? []);
    expect(toolResult.content).toEqual([
      { type: 'text', text: '4' },
      { type: 'text', text: '4' }
    ]);
  });
});
