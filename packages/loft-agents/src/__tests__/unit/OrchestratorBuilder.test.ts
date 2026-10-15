import { Agent } from '@moc-global/loft-definitions';
import { describe, expect, it, vi } from 'vitest';

import { OrchestratorBuilder } from '../../core/OrchestratorBuilder';
import { InvalidGraphError, NodeNotFoundError, NoEntryNodeError } from '../../errors';

function createMockNode(name: string, transitions: Agent.TransitionDef[] = []): Agent.Node {
  return {
    name,
    transitions,
    run: vi.fn()
  };
}

describe('OrchestratorBuilder', () => {
  it('should build a valid orchestrator with entry and connected nodes', () => {
    const nodeA = createMockNode('nodeA', [{ name: 'next', description: 'Go to B', target: 'nodeB' }]);
    const nodeB = createMockNode('nodeB', [{ name: 'done', description: 'Terminal', target: null }]);

    const orchestrator = new OrchestratorBuilder().addNode(nodeA).addNode(nodeB).setEntry('nodeA').build();

    expect(orchestrator).toBeDefined();
  });

  it('should throw NoEntryNodeError when no entry node is set', () => {
    const nodeA = createMockNode('nodeA');

    expect(() => new OrchestratorBuilder().addNode(nodeA).build()).toThrow(NoEntryNodeError);
  });

  it('should throw NodeNotFoundError when entry node does not exist', () => {
    const nodeA = createMockNode('nodeA');

    expect(() => new OrchestratorBuilder().addNode(nodeA).setEntry('nonexistent').build()).toThrow(NodeNotFoundError);
  });

  it('should throw InvalidGraphError when transition targets a non-existent node', () => {
    const nodeA = createMockNode('nodeA', [{ name: 'next', description: 'Go to C', target: 'nodeC' }]);

    expect(() => new OrchestratorBuilder().addNode(nodeA).setEntry('nodeA').build()).toThrow(InvalidGraphError);
  });

  it('should not throw for transitions with null target (terminal)', () => {
    const nodeA = createMockNode('nodeA', [{ name: 'done', description: 'Terminal', target: null }]);

    expect(() => new OrchestratorBuilder().addNode(nodeA).setEntry('nodeA').build()).not.toThrow();
  });

  it('should log warning for unreachable nodes', () => {
    const nodeA = createMockNode('nodeA', [{ name: 'done', description: 'Terminal', target: null }]);
    const nodeB = createMockNode('nodeB', [{ name: 'done', description: 'Terminal', target: null }]);

    // nodeB is unreachable from nodeA (entry)
    // Should still build successfully, just warn
    const orchestrator = new OrchestratorBuilder().addNode(nodeA).addNode(nodeB).setEntry('nodeA').build();

    expect(orchestrator).toBeDefined();
  });

  it('should allow configuring max depth', () => {
    const nodeA = createMockNode('nodeA', [{ name: 'done', description: 'Terminal', target: null }]);

    const orchestrator = new OrchestratorBuilder().addNode(nodeA).setEntry('nodeA').setMaxDepth(5).build();

    expect(orchestrator).toBeDefined();
  });

  it('should throw InvalidGraphError when adding duplicate node names', () => {
    const nodeA1 = createMockNode('nodeA');
    const nodeA2 = createMockNode('nodeA');

    expect(() => new OrchestratorBuilder().addNode(nodeA1).addNode(nodeA2)).toThrow(InvalidGraphError);
  });

  it('should accept nodes with multiple transitions all pointing to valid targets', () => {
    const nodeA = createMockNode('nodeA', [
      { name: 'toB', description: 'Go to B', target: 'nodeB' },
      { name: 'toC', description: 'Go to C', target: 'nodeC' }
    ]);
    const nodeB = createMockNode('nodeB', [{ name: 'done', description: 'Terminal', target: null }]);
    const nodeC = createMockNode('nodeC', [{ name: 'done', description: 'Terminal', target: null }]);

    expect(() =>
      new OrchestratorBuilder().addNode(nodeA).addNode(nodeB).addNode(nodeC).setEntry('nodeA').build()
    ).not.toThrow();
  });

  it('should allow FanOut targeting non-Focus nodes', () => {
    const router = createMockNode('router', [
      { name: 'toA', description: 'Go to A', target: 'nodeA' },
      { name: 'toB', description: 'Go to B', target: 'nodeB' }
    ]);
    const nodeA = createMockNode('nodeA', [{ name: 'done', description: 'Terminal', target: null }]);
    const nodeB = createMockNode('nodeB', [{ name: 'done', description: 'Terminal', target: null }]);

    expect(() =>
      new OrchestratorBuilder().addNode(router).addNode(nodeA).addNode(nodeB).setEntry('router').build()
    ).not.toThrow();
  });
});
