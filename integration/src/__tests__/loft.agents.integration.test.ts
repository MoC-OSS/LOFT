import 'reflect-metadata';

import { LOFT } from '@moc-global/loft';
import {
  FanOutPartialError,
  LoftAgentNode,
  OrchestratorBuilder,
  SharedContext,
  TeamBuilder
} from '@moc-global/loft-agents';
import { Agent, Chat, Type } from '@moc-global/loft-definitions';
import { ScriptedLLMStrategy, ScriptedReply } from '@moc-global/loft-test-suite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDB, type TestDatabaseInstance } from './initDB';
import { createChatConstructor, createLoftConstructor } from './loftInit';

const MANIFEST = 'agents';
const NODES = ['planner', 'flights', 'hotels', 'checker', 'editor', 'summary'] as const;
type NodeName = (typeof NODES)[number];

describe('loft-agents orchestration on LOFT', () => {
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

  /** One scripted model per node, registered under the node's name, so parallel nodes get their own replies. */
  async function startAgents(replies: Partial<Record<NodeName, ScriptedReply[]>>) {
    const loftConstructor = createLoftConstructor(createChatConstructor(testDb));
    const models = {} as Record<NodeName, ScriptedLLMStrategy>;
    for (const name of NODES) {
      models[name] = new ScriptedLLMStrategy(name, replies[name] ?? []);
      await loftConstructor.registerLlmStrategy(name, models[name]);
    }
    const loft = loftConstructor.getInstance();
    const session = await loft.chat.createSession({
      currentLlmName: 'planner',
      currentManifestName: MANIFEST,
      ctx: {}
    });
    return { loft, models, sessionId: session.id };
  }

  function node(loft: LOFT<Chat.ChatInterface>, name: NodeName, targets: Array<string | null>) {
    return new LoftAgentNode({
      name,
      loft,
      llmName: name,
      manifestName: MANIFEST,
      transitions: targets.map((target) => ({ name: `to-${target}`, description: `Go to ${target}`, target }))
    });
  }

  function fanOut(loft: LOFT<Chat.ChatInterface>, name: NodeName, targets: string[]) {
    return new LoftAgentNode({
      name,
      loft,
      llmName: name,
      manifestName: MANIFEST,
      transitions: targets.map((target) => ({ name: `to-${target}`, description: target, target })),
      transitionResolver: () => ({ type: Agent.TransitionType.FAN_OUT, targets })
    });
  }

  const received = (model: ScriptedLLMStrategy) => model.calls.map((call) => call.messages.at(-1)?.text);

  it('runs an entry node, a parallel step, a team and a terminal node', async () => {
    const { loft, models, sessionId } = await startAgents({
      planner: [{ text: 'Plan: Lisbon, 3 nights' }],
      flights: [{ text: 'Flight TP123' }],
      hotels: [{ text: 'Hotel Riverside' }],
      checker: [{ text: 'Checked: TP123 + Riverside' }],
      editor: [{ text: 'Itinerary ready' }],
      summary: [{ text: 'Your Lisbon trip is booked.' }]
    });
    const reviewTeam = new TeamBuilder('review')
      .addNode(node(loft, 'checker', ['editor']))
      .addNode(node(loft, 'editor', []))
      .setEntry('checker')
      .addTransition({ name: 'done', description: 'Review complete', target: 'summary' })
      .build();
    let metrics: Agent.OrchestratorMetrics | undefined;
    const orchestrator = new OrchestratorBuilder()
      .addNode(fanOut(loft, 'planner', ['flights', 'hotels']))
      .addNode(node(loft, 'flights', ['review']))
      .addNode(node(loft, 'hotels', ['review']))
      .addNode(reviewTeam)
      .addNode(node(loft, 'summary', []))
      .setEntry('planner')
      .setMetricsCallback((m) => (metrics = m))
      .build();

    const reply = await orchestrator.run(
      { role: Agent.AgentMessageRole.USER, content: 'Plan a trip to Lisbon' },
      sessionId
    );

    expect(reply).toEqual({ role: Agent.AgentMessageRole.ASSISTANT, content: 'Your Lisbon trip is booked.' });
    // Each node called its own model once, with its own system message
    for (const name of NODES) {
      expect(models[name].calls, name).toHaveLength(1);
      expect(models[name].calls[0].systemMessage).toBe(`You are the ${name} agent.`);
    }
    // Each node receives the previous node's answer as its input
    expect(received(models.planner)).toEqual(['Plan a trip to Lisbon']);
    expect(received(models.flights)).toEqual(['Plan: Lisbon, 3 nights']);
    expect(received(models.hotels)).toEqual(['Plan: Lisbon, 3 nights']);
    // After the parallel step the next node's input is the last branch's answer (Orchestrator.executeFanOut);
    // every node's answer reaches later nodes through the shared context
    expect(received(models.checker)).toEqual(['Hotel Riverside']);
    const sharedContext = (model: ScriptedLLMStrategy) =>
      model.calls[0].messages.find((m) => m.role === Type.LLM.UnifiedMessageRole.system)?.text ?? '';
    expect(sharedContext(models.checker)).toContain('Flight TP123');
    expect(sharedContext(models.checker)).toContain('Hotel Riverside');
    // The team's nodes write inside the team; the parent sees their keys as team:<team>:<node>
    expect(sharedContext(models.summary)).toContain('team:review:checker');
    expect(sharedContext(models.summary)).toContain('Checked: TP123 + Riverside');
    expect(received(models.editor)).toEqual(['Checked: TP123 + Riverside']);
    // The team's answer is its last node's answer
    expect(received(models.summary)).toEqual(['Itinerary ready']);

    // The team counts as one node of the parent graph
    expect(metrics?.transitionPath).toEqual(['planner', 'flights', 'hotels', 'review', 'summary']);
    expect(metrics?.depthReached).toBe(4);
    expect(metrics?.nodeMetrics.find((m) => m.nodeName === 'summary')?.usage).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      model: 'scripted'
    });
  });

  it('cancels the in-flight model call and starts no further node when the run is aborted', async () => {
    const { loft, models, sessionId } = await startAgents({
      planner: [{ waitForAbort: true }],
      summary: [{ text: 'never sent' }]
    });
    const orchestrator = new OrchestratorBuilder()
      .addNode(node(loft, 'planner', ['summary']))
      .addNode(node(loft, 'summary', []))
      .setEntry('planner')
      .build();
    const controller = new AbortController();

    const run = orchestrator.run({ role: Agent.AgentMessageRole.USER, content: 'Start' }, sessionId, undefined, {
      signal: controller.signal
    });
    await expect.poll(() => models.planner.calls.length).toBe(1);
    controller.abort(new Error('user left'));

    await expect(run).rejects.toThrow('user left');
    expect(models.summary.calls).toHaveLength(0);
  });

  it('fails the run when a parallel branch fails, or continues with the others under ErrorStrategy.CONTINUE', async () => {
    const replies = (): Partial<Record<NodeName, ScriptedReply[]>> => ({
      planner: [{ text: 'Plan' }],
      flights: [{ error: new Error('flight search is down') }],
      hotels: [{ text: 'Hotel Riverside' }],
      summary: [{ text: 'Booked the hotel only.' }]
    });
    const build = (loft: LOFT<Chat.ChatInterface>, strategy?: Agent.ErrorStrategy) => {
      const builder = new OrchestratorBuilder()
        .addNode(fanOut(loft, 'planner', ['flights', 'hotels']))
        .addNode(node(loft, 'flights', ['summary']))
        .addNode(node(loft, 'hotels', ['summary']))
        .addNode(node(loft, 'summary', []))
        .setEntry('planner');
      return (strategy ? builder.setErrorStrategy(strategy) : builder).build();
    };
    const message = { role: Agent.AgentMessageRole.USER, content: 'Plan' };

    // Default: FAIL_FAST
    const failFast = await startAgents(replies());
    const error = await build(failFast.loft)
      .run(message, failFast.sessionId)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FanOutPartialError);
    const [rejected] = (error as FanOutPartialError).rejected;
    expect((error as FanOutPartialError).rejected).toHaveLength(1);
    expect(rejected.nodeName).toBe('flights');
    // generate() wraps the provider error in a GenerateError
    expect(rejected.error.message).toContain('flight search is down');
    expect(failFast.models.summary.calls).toHaveLength(0);

    // CONTINUE: the run goes on and records the failure in the shared context
    const tolerant = await startAgents(replies());
    const context = new SharedContext(tolerant.sessionId);
    const reply = await build(tolerant.loft, Agent.ErrorStrategy.CONTINUE).run(message, tolerant.sessionId, context);
    expect(reply.content).toBe('Booked the hotel only.');
    expect(context.get(Agent.FANOUT_REJECTED_KEY)).toEqual([
      { nodeName: 'flights', error: expect.stringContaining('flight search is down') }
    ]);
  });

  it('hands over to the next node when a Focus completes inside the run', async () => {
    const { loft, models, sessionId } = await startAgents({
      planner: [
        { toolCalls: [{ name: 'update_trip_focus', arguments: { city: 'Lisbon', guests: 2 } }] },
        { text: 'All set.' }
      ],
      summary: [{ text: 'Booking Lisbon for 2.' }]
    });
    loft.registerFocus('trip', {
      agentName: 'trip',
      prompt: 'Collect the trip details',
      fields: [
        { key: 'city', type: Agent.FocusFieldType.STRING, required: true, description: 'City' },
        { key: 'guests', type: Agent.FocusFieldType.NUMBER, required: true, description: 'Guests' }
      ],
      onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'summary' }
    });
    const intake = new LoftAgentNode({
      name: 'planner',
      loft,
      llmName: 'planner',
      manifestName: MANIFEST,
      transitions: [{ name: 'collecting', description: 'Still collecting', target: null }],
      focusName: 'trip',
      onFocusComplete: { type: Agent.FocusActionType.TRANSITION, target: 'summary' }
    });
    const orchestrator = new OrchestratorBuilder()
      .addNode(intake)
      .addNode(node(loft, 'summary', []))
      .setEntry('planner')
      .build();

    const reply = await orchestrator.run({ role: Agent.AgentMessageRole.USER, content: 'Lisbon for two' }, sessionId);

    // The Focus status travels with the intake's answer, lists included, and the next node accepts it
    expect(reply.content).toBe('Booking Lisbon for 2.');
    expect(received(models.summary)).toEqual(['All set.']);
  });

  it('retries a failed node under its retry policy', async () => {
    const { loft, models, sessionId } = await startAgents({
      planner: [{ error: new Error('rate limited') }, { text: 'Plan after retry' }]
    });
    let metrics: Agent.OrchestratorMetrics | undefined;
    const orchestrator = new OrchestratorBuilder()
      .addNode(node(loft, 'planner', []), { retry: { maxRetries: 1, delayMs: 0 } })
      .setEntry('planner')
      .setMetricsCallback((m) => (metrics = m))
      .build();

    const reply = await orchestrator.run({ role: Agent.AgentMessageRole.USER, content: 'Plan' }, sessionId);

    expect(reply.content).toBe('Plan after retry');
    expect(models.planner.calls).toHaveLength(2);
    expect(metrics?.nodeMetrics[0]).toMatchObject({ nodeName: 'planner', retryCount: 1 });
  });
});
