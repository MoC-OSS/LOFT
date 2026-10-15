import { Agent } from '@moc-global/loft-definitions';
import { describe, expect, it, vi } from 'vitest';

import { OrchestratorBuilder } from '../../core/OrchestratorBuilder';
import { msg, nodeResult, single, staticNode, stubNode, terminal } from '../helpers';

describe('Metrics', () => {
  it('should invoke callback with OrchestratorMetrics after successful run', async () => {
    const callback = vi.fn();

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
      .setMetricsCallback(callback)
      .build();

    await orchestrator.run(msg('Start'), 'session-1');

    expect(callback).toHaveBeenCalledOnce();
    const metrics: Agent.OrchestratorMetrics = callback.mock.calls[0][0];
    expect(metrics.orchestratorDurationMs).toBeGreaterThanOrEqual(0);
    expect(metrics.depthReached).toBe(2);
    expect(metrics.transitionPath).toEqual(['nodeA', 'nodeB']);
    expect(metrics.nodeMetrics).toHaveLength(2);
    expect(metrics.nodeMetrics[0].nodeName).toBe('nodeA');
    expect(metrics.nodeMetrics[1].nodeName).toBe('nodeB');
  });

  it('should invoke callback with metrics even on error', async () => {
    const callback = vi.fn();

    const nodeA = staticNode(
      'nodeA',
      [{ name: 'next', description: 'Go to B', target: 'nodeB' }],
      nodeResult('From A', single('nodeB'))
    );
    const nodeB: Agent.Node = {
      name: 'nodeB',
      transitions: [{ name: 'done', description: 'Terminal', target: null }],
      run: vi.fn().mockRejectedValue(new Error('B failed')) as Agent.Node['run']
    };

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .addNode(nodeB)
      .setEntry('nodeA')
      .setMetricsCallback(callback)
      .build();

    await expect(orchestrator.run(msg('Start'), 'session-1')).rejects.toThrow('B failed');

    expect(callback).toHaveBeenCalledOnce();
    const metrics: Agent.OrchestratorMetrics = callback.mock.calls[0][0];
    expect(metrics.nodeMetrics).toHaveLength(2);
    expect(metrics.nodeMetrics[1].error?.message).toBe('B failed');
  });

  it('should record duration for each node', async () => {
    const callback = vi.fn();

    const nodeA = stubNode('nodeA', [{ name: 'done', description: 'Terminal', target: null }], async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return nodeResult('Done', terminal());
    });

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .setEntry('nodeA')
      .setMetricsCallback(callback)
      .build();

    await orchestrator.run(msg('Start'), 'session-1');

    const metrics: Agent.OrchestratorMetrics = callback.mock.calls[0][0];
    expect(metrics.nodeMetrics[0].durationMs).toBeGreaterThanOrEqual(10);
  });

  it('should record transition path', async () => {
    const callback = vi.fn();

    const nodeA = staticNode(
      'nodeA',
      [{ name: 'next', description: 'Go to B', target: 'nodeB' }],
      nodeResult('From A', single('nodeB'))
    );
    const nodeB = staticNode(
      'nodeB',
      [{ name: 'next', description: 'Go to C', target: 'nodeC' }],
      nodeResult('From B', single('nodeC'))
    );
    const nodeC = staticNode(
      'nodeC',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('From C', terminal())
    );

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .addNode(nodeB)
      .addNode(nodeC)
      .setEntry('nodeA')
      .setMetricsCallback(callback)
      .build();

    await orchestrator.run(msg('Start'), 'session-1');

    const metrics: Agent.OrchestratorMetrics = callback.mock.calls[0][0];
    expect(metrics.transitionPath).toEqual(['nodeA', 'nodeB', 'nodeC']);
  });

  it('should not invoke callback when not configured', async () => {
    const nodeA = staticNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('Done', terminal())
    );

    const orchestrator = new OrchestratorBuilder().addNode(nodeA).setEntry('nodeA').build();

    // Should work without errors
    const result = await orchestrator.run(msg('Start'), 'session-1');
    expect(result.content).toBe('Done');
  });

  it('should capture NodeMetricsAware usage', async () => {
    const callback = vi.fn();

    const metricsAwareNode: Agent.Node & Agent.NodeMetricsAware = {
      name: 'nodeA',
      transitions: [{ name: 'done', description: 'Terminal', target: null }],
      run: vi.fn(async () => nodeResult('Done', terminal())),
      getLastMetrics: vi.fn(() => ({
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, model: 'test-model' }
      }))
    };

    const orchestrator = new OrchestratorBuilder()
      .addNode(metricsAwareNode)
      .setEntry('nodeA')
      .setMetricsCallback(callback)
      .build();

    await orchestrator.run(msg('Start'), 'session-1');

    const metrics: Agent.OrchestratorMetrics = callback.mock.calls[0][0];
    expect(metrics.nodeMetrics[0].usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      model: 'test-model'
    });
  });
});
