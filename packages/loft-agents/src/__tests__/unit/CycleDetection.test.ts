import { describe, expect, it, vi } from 'vitest';

import { OrchestratorBuilder } from '../../core/OrchestratorBuilder';
import { msg, nodeResult, single, stubNode, terminal } from '../helpers';

describe('CycleDetection', () => {
  it('should detect A → B → A → B cycle pattern and log warning', async () => {
    let callCount = 0;
    const nodeA = stubNode('nodeA', [{ name: 'toB', description: 'Go to B', target: 'nodeB' }], async () => {
      callCount++;
      if (callCount >= 3) return nodeResult('Done', terminal());
      return nodeResult('A', single('nodeB'));
    });
    const nodeB = stubNode(
      'nodeB',
      [
        { name: 'toA', description: 'Go to A', target: 'nodeA' },
        { name: 'done', description: 'Terminal', target: null }
      ],
      async () => nodeResult('B', single('nodeA'))
    );

    // Spy on Logger prototype to capture warning
    const { Logger } = await import('@moc-global/loft-definitions');
    const warnSpy = vi.spyOn(Logger.prototype, 'warn');

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .addNode(nodeB)
      .setEntry('nodeA')
      .setCycleDetection(true)
      .setMaxDepth(20)
      .build();

    await orchestrator.run(msg('Start'), 'session-1');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Cycle detected'));
    warnSpy.mockRestore();
  });

  it('should not log warning for non-repeating sequence', async () => {
    const nodeA = stubNode('nodeA', [{ name: 'toB', description: 'Go to B', target: 'nodeB' }], async () =>
      nodeResult('A', single('nodeB'))
    );
    const nodeB = stubNode('nodeB', [{ name: 'toC', description: 'Go to C', target: 'nodeC' }], async () =>
      nodeResult('B', single('nodeC'))
    );
    const nodeC = stubNode('nodeC', [{ name: 'done', description: 'Terminal', target: null }], async () =>
      nodeResult('C', terminal())
    );

    const { Logger } = await import('@moc-global/loft-definitions');
    const warnSpy = vi.spyOn(Logger.prototype, 'warn');

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .addNode(nodeB)
      .addNode(nodeC)
      .setEntry('nodeA')
      .setCycleDetection(true)
      .build();

    await orchestrator.run(msg('Start'), 'session-1');

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Cycle detected'));
    warnSpy.mockRestore();
  });

  it('should not detect cycles when cycle detection is disabled', async () => {
    let callCount = 0;
    const nodeA = stubNode('nodeA', [{ name: 'toB', description: 'Go to B', target: 'nodeB' }], async () => {
      callCount++;
      if (callCount >= 3) return nodeResult('Done', terminal());
      return nodeResult('A', single('nodeB'));
    });
    const nodeB = stubNode('nodeB', [{ name: 'toA', description: 'Go to A', target: 'nodeA' }], async () =>
      nodeResult('B', single('nodeA'))
    );

    const { Logger } = await import('@moc-global/loft-definitions');
    const warnSpy = vi.spyOn(Logger.prototype, 'warn');

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .addNode(nodeB)
      .setEntry('nodeA')
      .setMaxDepth(20)
      .build();

    await orchestrator.run(msg('Start'), 'session-1');

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Cycle detected'));
    warnSpy.mockRestore();
  });

  it('should not throw on cycle detection — advisory only', async () => {
    let callCount = 0;
    const nodeA = stubNode('nodeA', [{ name: 'toB', description: 'Go to B', target: 'nodeB' }], async () => {
      callCount++;
      if (callCount >= 3) return nodeResult('Done', terminal());
      return nodeResult('A', single('nodeB'));
    });
    const nodeB = stubNode('nodeB', [{ name: 'toA', description: 'Go to A', target: 'nodeA' }], async () =>
      nodeResult('B', single('nodeA'))
    );

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .addNode(nodeB)
      .setEntry('nodeA')
      .setCycleDetection(true)
      .setMaxDepth(20)
      .build();

    // Should complete without throwing
    const result = await orchestrator.run(msg('Start'), 'session-1');
    expect(result.content).toBe('Done');
  });
});
