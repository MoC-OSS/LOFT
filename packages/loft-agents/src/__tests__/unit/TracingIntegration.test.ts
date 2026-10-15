import { Strategy } from '@moc-global/loft-definitions';
import { describe, expect, it, vi } from 'vitest';

import { OrchestratorBuilder } from '../../core/OrchestratorBuilder';
import { fanOut, msg, nodeResult, single, staticNode, terminal } from '../helpers';

function createMockSpan(): Strategy.Tracer.Span {
  const mockSpan: Strategy.Tracer.Span = {
    id: `span-${Math.random().toString(36).slice(2)}`,
    end: vi.fn(),
    span: vi.fn(() => createMockSpan()),
    generation: vi.fn(() => ({ id: 'gen-1', end: vi.fn() })),
    event: vi.fn()
  };
  return mockSpan;
}

function createMockTracer(): Strategy.Tracer.Tracer & { _rootSpan: Strategy.Tracer.Span } {
  const rootSpan = createMockSpan();
  return {
    _rootSpan: rootSpan,
    span: vi.fn(() => rootSpan),
    generation: vi.fn(() => ({ id: 'gen-1', end: vi.fn() })),
    event: vi.fn(),
    score: vi.fn(),
    update: vi.fn(),
    flushAsync: vi.fn(),
    withParent: vi.fn()
  };
}

describe('TracingIntegration', () => {
  it('should create orchestrator span wrapping entire run', async () => {
    const tracer = createMockTracer();
    const nodeA = staticNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('Done', terminal())
    );

    const orchestrator = new OrchestratorBuilder().addNode(nodeA).setEntry('nodeA').setTracer(tracer).build();

    await orchestrator.run(msg('Hello'), 'session-1');

    expect(tracer.span).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'orchestrator.run', input: { message: 'Hello', sessionId: 'session-1' } })
    );
    expect(tracer._rootSpan.end).toHaveBeenCalledWith(
      expect.objectContaining({ output: expect.objectContaining({ message: 'Done' }) })
    );
  });

  it('should create node spans nested under orchestrator span', async () => {
    const tracer = createMockTracer();
    const nodeA = staticNode(
      'nodeA',
      [{ name: 'next', description: 'Go to B', target: 'nodeB' }],
      nodeResult('From A', single('nodeB'))
    );
    const nodeB = staticNode(
      'nodeB',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('From B', terminal())
    );

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .addNode(nodeB)
      .setEntry('nodeA')
      .setTracer(tracer)
      .build();

    await orchestrator.run(msg('Start'), 'session-1');

    // Orchestrator span is created, then node spans are created as children
    expect(tracer._rootSpan.span).toHaveBeenCalledWith(expect.objectContaining({ name: 'node.nodeA' }));
    expect(tracer._rootSpan.span).toHaveBeenCalledWith(expect.objectContaining({ name: 'node.nodeB' }));
  });

  it('should create FanOut span wrapping parallel execution', async () => {
    const tracer = createMockTracer();
    const nodeA = staticNode(
      'nodeA',
      [
        { name: 'toB', description: 'Go to B', target: 'nodeB' },
        { name: 'toC', description: 'Go to C', target: 'nodeC' }
      ],
      nodeResult('A', fanOut(['nodeB', 'nodeC']))
    );
    const nodeB = staticNode(
      'nodeB',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('B', terminal())
    );
    const nodeC = staticNode(
      'nodeC',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('C', terminal())
    );

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .addNode(nodeB)
      .addNode(nodeC)
      .setEntry('nodeA')
      .setTracer(tracer)
      .build();

    await orchestrator.run(msg('Start'), 'session-1');

    expect(tracer._rootSpan.span).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'orchestrator.fanOut', input: { targets: ['nodeB', 'nodeC'] } })
    );
  });

  it('should record error in orchestrator span on failure', async () => {
    const tracer = createMockTracer();
    const nodeA: any = {
      name: 'nodeA',
      transitions: [{ name: 'done', description: 'Terminal', target: null }],
      run: vi.fn().mockRejectedValue(new Error('Node failed'))
    };

    const orchestrator = new OrchestratorBuilder().addNode(nodeA).setEntry('nodeA').setTracer(tracer).build();

    await expect(orchestrator.run(msg('Start'), 'session-1')).rejects.toThrow('Node failed');

    expect(tracer._rootSpan.end).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'ERROR', metadata: expect.objectContaining({ error: 'Node failed' }) })
    );
  });

  it('should not create spans when tracer is not configured', async () => {
    const nodeA = staticNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('Done', terminal())
    );

    const orchestrator = new OrchestratorBuilder().addNode(nodeA).setEntry('nodeA').build();

    // Should work without errors and without any tracing
    const result = await orchestrator.run(msg('Start'), 'session-1');
    expect(result.content).toBe('Done');
  });
});
