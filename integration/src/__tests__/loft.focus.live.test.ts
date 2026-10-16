import 'reflect-metadata';

import { Agent } from '@moc-global/loft-definitions';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initAnthropicStrategy } from './AnthropicStrategyWithCallManager';
import { hasKeys } from './config';
import { initGeminiStrategy } from './GeminiStrategyWithCallManager';
import { initDB, type TestDatabaseInstance } from './initDB';
import { createChatConstructor, createLoftConstructor } from './loftInit';
import { initOpenAiStrategy } from './OpenAiStrategyWithCallManager';
import { textOf, userMessage } from './scriptedChat';

const ORDER_FOCUS: Agent.Focus = {
  agentName: 'order',
  prompt: 'Collect the pizza order. Greet the user and ask for the pizza size.',
  fields: [
    {
      key: 'size',
      type: Agent.FocusFieldType.ENUM,
      values: ['small', 'large'],
      required: true,
      description: 'Pizza size'
    }
  ],
  onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'done' }
};

type LoftConstructor = ReturnType<typeof createLoftConstructor>;

// Each provider registers its own strategy type, so the registration is a function per provider
const PROVIDERS = [
  {
    provider: 'OpenAI',
    key: 'LOFT_OPENAI_API_KEY' as const,
    llmName: 'focus-gpt-4o-mini',
    register: (lc: LoftConstructor, name: string) => lc.registerLlmStrategy(name, initOpenAiStrategy(name))
  },
  {
    provider: 'Anthropic',
    key: 'LOFT_ANTHROPIC_API_KEY' as const,
    llmName: 'focus-claude-haiku',
    register: (lc: LoftConstructor, name: string) => lc.registerLlmStrategy(name, initAnthropicStrategy(name))
  },
  {
    provider: 'Gemini',
    key: 'LOFT_GEMINI_VERTEX_PROJECT' as const,
    llmName: 'focus-gemini-flash-lite',
    register: (lc: LoftConstructor, name: string) => lc.registerLlmStrategy(name, initGeminiStrategy(name))
  }
];

// Live: runs each provider whose key is set in .env.test
const AVAILABLE = PROVIDERS.filter(({ key }) => hasKeys(key));

describe.runIf(AVAILABLE.length > 0)('Focus turn without messages with real providers', () => {
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

  async function startFocus(p: (typeof PROVIDERS)[number]) {
    const chatConstructor = createChatConstructor(testDb);
    const loftConstructor = createLoftConstructor(chatConstructor);
    await p.register(loftConstructor, p.llmName);
    const loft = loftConstructor.getInstance();
    loft.registerFocus('order', ORDER_FOCUS);
    const session = await loft.chat.createSession({
      currentLlmName: p.llmName,
      currentManifestName: 'test-bot',
      ctx: {},
      focusAgent: 'order'
    });
    return { loft, session };
  }

  describe.each(AVAILABLE.length > 0 ? AVAILABLE : PROVIDERS)('$provider', (p) => {
    // The Focus prompt opens the conversation, so the first generate call needs no message from the user
    it('opens the Focus conversation, then takes the answer of the user', async () => {
      const { loft, session } = await startFocus(p);

      const first = await loft.chat.generate({ sessionId: session.id });
      expect(textOf(first.messages.llmResponse.topChoice).length).toBeGreaterThan(0);
      expect(first.focusStatus).toMatchObject({ missing: ['size'], ready: false });
      await first.messages.save();

      // The saved conversation now starts with the assistant
      const second = await loft.chat.generate({
        sessionId: session.id,
        directMessages: [{ ...userMessage('A large one, please', session.id), llmName: p.llmName }]
      });
      // Depends on the model calling the Focus update tool, which every provider did in the runs so far
      expect(second.focusStatus).toMatchObject({ filled: { size: 'large' }, ready: true });
    }, 90000);

    it('answers a turn without messages after its own answer', async () => {
      const { loft, session } = await startFocus(p);
      const first = await loft.chat.generate({ sessionId: session.id });
      await first.messages.save();

      // The saved conversation ends with the assistant
      const second = await loft.chat.generate({ sessionId: session.id });
      expect(textOf(second.messages.llmResponse.topChoice).length).toBeGreaterThan(0);
    }, 90000);
  });
});
