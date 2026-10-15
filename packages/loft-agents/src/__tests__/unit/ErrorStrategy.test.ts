import { Agent } from '@moc-global/loft-definitions';
import { describe, expect, it, vi } from 'vitest';

import { OrchestratorBuilder } from '../../core/OrchestratorBuilder';
import { FanOutPartialError } from '../../errors';
import { fanOut, msg, nodeResult, single, staticNode, stubNode, terminal } from '../helpers';

describe('ErrorStrategy', () => {
  it('should throw FanOutPartialError on any failure with fail-fast (default)', async () => {
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
      nodeResult('B ok', terminal())
    );

    const nodeC: Agent.Node = {
      name: 'nodeC',
      transitions: [{ name: 'done', description: 'Terminal', target: null }],
      run: vi.fn().mockRejectedValue(new Error('C failed')) as Agent.Node['run']
    };

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .addNode(nodeB)
      .addNode(nodeC)
      .setEntry('nodeA')
      .build();

    await expect(orchestrator.run(msg('Start'), 'session-1')).rejects.toThrow(FanOutPartialError);
  });

  it('should proceed with partial results when errorStrategy is continue', async () => {
    const nodeA = staticNode(
      'nodeA',
      [
        { name: 'toB', description: 'Go to B', target: 'nodeB' },
        { name: 'toC', description: 'Go to C', target: 'nodeC' }
      ],
      nodeResult('A', fanOut(['nodeB', 'nodeC']))
    );

    const nodeB = stubNode(
      'nodeB',
      [{ name: 'toD', description: 'Go to D', target: 'nodeD' }],
      async (_msg, sharedContext) => {
        sharedContext.for('nodeB').set('result', 'B-result');
        return nodeResult('From B', single('nodeD'));
      }
    );

    const nodeC: Agent.Node = {
      name: 'nodeC',
      transitions: [{ name: 'toD', description: 'Go to D', target: 'nodeD' }],
      run: vi.fn().mockRejectedValue(new Error('C failed')) as Agent.Node['run']
    };

    const nodeD = stubNode(
      'nodeD',
      [{ name: 'done', description: 'Terminal', target: null }],
      async (_msg, sharedContext) => {
        const bResult = sharedContext.for('nodeB').get<string>('result');
        return nodeResult(`D got: ${bResult}`, terminal());
      }
    );

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .addNode(nodeB)
      .addNode(nodeC)
      .addNode(nodeD)
      .setEntry('nodeA')
      .setErrorStrategy(Agent.ErrorStrategy.CONTINUE)
      .build();

    const result = await orchestrator.run(msg('Start'), 'session-1');
    expect(result.content).toBe('D got: B-result');
  });

  it('should store rejected info in SharedContext under __fanout.rejected when continue', async () => {
    let capturedRejected: unknown;

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
      [{ name: 'toD', description: 'Go to D', target: 'nodeD' }],
      nodeResult('B ok', single('nodeD'))
    );

    const nodeC: Agent.Node = {
      name: 'nodeC',
      transitions: [{ name: 'toD', description: 'Go to D', target: 'nodeD' }],
      run: vi.fn().mockRejectedValue(new Error('C exploded')) as Agent.Node['run']
    };

    const nodeD = stubNode(
      'nodeD',
      [{ name: 'done', description: 'Terminal', target: null }],
      async (_msg, sharedContext) => {
        capturedRejected = sharedContext.get(Agent.FANOUT_REJECTED_KEY);
        return nodeResult('Done', terminal());
      }
    );

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .addNode(nodeB)
      .addNode(nodeC)
      .addNode(nodeD)
      .setEntry('nodeA')
      .setErrorStrategy(Agent.ErrorStrategy.CONTINUE)
      .build();

    await orchestrator.run(msg('Start'), 'session-1');

    expect(capturedRejected).toEqual([{ nodeName: 'nodeC', error: 'C exploded' }]);
  });

  it('should throw FanOutPartialError when ALL branches fail even with continue', async () => {
    const nodeA = staticNode(
      'nodeA',
      [
        { name: 'toB', description: 'Go to B', target: 'nodeB' },
        { name: 'toC', description: 'Go to C', target: 'nodeC' }
      ],
      nodeResult('A', fanOut(['nodeB', 'nodeC']))
    );

    const nodeB: Agent.Node = {
      name: 'nodeB',
      transitions: [{ name: 'done', description: 'Terminal', target: null }],
      run: vi.fn().mockRejectedValue(new Error('B failed')) as Agent.Node['run']
    };

    const nodeC: Agent.Node = {
      name: 'nodeC',
      transitions: [{ name: 'done', description: 'Terminal', target: null }],
      run: vi.fn().mockRejectedValue(new Error('C failed')) as Agent.Node['run']
    };

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .addNode(nodeB)
      .addNode(nodeC)
      .setEntry('nodeA')
      .setErrorStrategy(Agent.ErrorStrategy.CONTINUE)
      .build();

    await expect(orchestrator.run(msg('Start'), 'session-1')).rejects.toThrow(FanOutPartialError);
  });

  it('should always propagate sequential node errors regardless of error strategy', async () => {
    const nodeA = staticNode(
      'nodeA',
      [{ name: 'toB', description: 'Go to B', target: 'nodeB' }],
      nodeResult('A', single('nodeB'))
    );

    const nodeB: Agent.Node = {
      name: 'nodeB',
      transitions: [{ name: 'done', description: 'Terminal', target: null }],
      run: vi.fn().mockRejectedValue(new Error('B crashed')) as Agent.Node['run']
    };

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .addNode(nodeB)
      .setEntry('nodeA')
      .setErrorStrategy(Agent.ErrorStrategy.CONTINUE)
      .build();

    await expect(orchestrator.run(msg('Start'), 'session-1')).rejects.toThrow('B crashed');
  });
});
