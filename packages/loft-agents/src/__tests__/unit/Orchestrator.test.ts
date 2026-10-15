import { Agent } from '@moc-global/loft-definitions';
import { describe, expect, it, vi } from 'vitest';

import { OrchestratorBuilder } from '../../core/OrchestratorBuilder';
import { SharedContext } from '../../core/SharedContext';
import { FanOutPartialError, MaxDepthExceededError, NodeRetryExhaustedError, NodeTimeoutError } from '../../errors';
import { fanOut, msg, nodeResult, single, staticNode, stubNode, terminal } from '../helpers';

describe('Orchestrator', () => {
  it('should execute a sequential chain A → B → C → terminal', async () => {
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
      .build();

    const result = await orchestrator.run(msg('Start'), 'session-1');

    expect(result.content).toBe('From C');
    expect(nodeA.run).toHaveBeenCalledOnce();
    expect(nodeB.run).toHaveBeenCalledOnce();
    expect(nodeC.run).toHaveBeenCalledOnce();
  });

  it('should return immediately on terminal from entry node', async () => {
    const nodeA = staticNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('Direct terminal', terminal())
    );

    const orchestrator = new OrchestratorBuilder().addNode(nodeA).setEntry('nodeA').build();

    const result = await orchestrator.run(msg('Start'), 'session-1');

    expect(result.content).toBe('Direct terminal');
    expect(nodeA.run).toHaveBeenCalledOnce();
  });

  it('should execute parallel fan-out A → [B, C] → D → terminal', async () => {
    const nodeA = staticNode(
      'nodeA',
      [
        { name: 'toB', description: 'Go to B', target: 'nodeB' },
        { name: 'toC', description: 'Go to C', target: 'nodeC' }
      ],
      nodeResult('From A', fanOut(['nodeB', 'nodeC']))
    );

    const nodeB = stubNode(
      'nodeB',
      [{ name: 'toD', description: 'Go to D', target: 'nodeD' }],
      async (_msg, sharedContext) => {
        sharedContext.for('nodeB').set('result', 'B-result');
        return nodeResult('From B', single('nodeD'));
      }
    );

    const nodeC = stubNode(
      'nodeC',
      [{ name: 'toD', description: 'Go to D', target: 'nodeD' }],
      async (_msg, sharedContext) => {
        sharedContext.for('nodeC').set('result', 'C-result');
        return nodeResult('From C', single('nodeD'));
      }
    );

    const nodeD = stubNode(
      'nodeD',
      [{ name: 'done', description: 'Terminal', target: null }],
      async (_msg, sharedContext) => {
        const bResult = sharedContext.for('nodeB').get<string>('result');
        const cResult = sharedContext.for('nodeC').get<string>('result');
        return nodeResult(`D got: ${bResult}, ${cResult}`, terminal());
      }
    );

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .addNode(nodeB)
      .addNode(nodeC)
      .addNode(nodeD)
      .setEntry('nodeA')
      .build();

    const result = await orchestrator.run(msg('Start'), 'session-1');

    expect(result.content).toBe('D got: B-result, C-result');
    expect(nodeB.run).toHaveBeenCalledOnce();
    expect(nodeC.run).toHaveBeenCalledOnce();
    expect(nodeD.run).toHaveBeenCalledOnce();
  });

  it('should throw MaxDepthExceededError on cyclic graph', async () => {
    const nodeA = staticNode(
      'nodeA',
      [{ name: 'toB', description: 'Go to B', target: 'nodeB' }],
      nodeResult('A', single('nodeB'))
    );
    const nodeB = staticNode(
      'nodeB',
      [{ name: 'toA', description: 'Go to A', target: 'nodeA' }],
      nodeResult('B', single('nodeA'))
    );

    const orchestrator = new OrchestratorBuilder().addNode(nodeA).addNode(nodeB).setEntry('nodeA').build();

    await expect(orchestrator.run(msg('Start'), 'session-1')).rejects.toThrow(MaxDepthExceededError);
  });

  it('should respect custom max depth', async () => {
    const nodeA = staticNode(
      'nodeA',
      [{ name: 'toB', description: 'Go to B', target: 'nodeB' }],
      nodeResult('A', single('nodeB'))
    );
    const nodeB = staticNode(
      'nodeB',
      [{ name: 'toA', description: 'Go to A', target: 'nodeA' }],
      nodeResult('B', single('nodeA'))
    );

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .addNode(nodeB)
      .setEntry('nodeA')
      .setMaxDepth(3)
      .build();

    await expect(orchestrator.run(msg('Start'), 'session-1')).rejects.toThrow(MaxDepthExceededError);
    expect(nodeA.run).toHaveBeenCalledTimes(2);
    expect(nodeB.run).toHaveBeenCalledTimes(1);
  });

  it('should count fan-out as one depth step', async () => {
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
      nodeResult('B', single('nodeD'))
    );
    const nodeC = staticNode(
      'nodeC',
      [{ name: 'toD', description: 'Go to D', target: 'nodeD' }],
      nodeResult('C', single('nodeD'))
    );
    const nodeD = staticNode(
      'nodeD',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('D', terminal())
    );

    // maxDepth=3: entry(1) + fanout(2) + D(3) = exactly 3, should succeed
    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA)
      .addNode(nodeB)
      .addNode(nodeC)
      .addNode(nodeD)
      .setEntry('nodeA')
      .setMaxDepth(3)
      .build();

    const result = await orchestrator.run(msg('Start'), 'session-1');
    expect(result.content).toBe('D');
  });

  it('should flow SharedContext data between nodes', async () => {
    const nodeA = stubNode(
      'nodeA',
      [{ name: 'next', description: 'Go to B', target: 'nodeB' }],
      async (_msg, sharedContext) => {
        sharedContext.for('nodeA').set('intent', 'billing');
        return nodeResult('Routed', single('nodeB'));
      }
    );

    const nodeB = stubNode(
      'nodeB',
      [{ name: 'done', description: 'Terminal', target: null }],
      async (_msg, sharedContext) => {
        const intent = sharedContext.for('nodeA').get<string>('intent');
        return nodeResult(`Intent is: ${intent}`, terminal());
      }
    );

    const orchestrator = new OrchestratorBuilder().addNode(nodeA).addNode(nodeB).setEntry('nodeA').build();

    const result = await orchestrator.run(msg('Start'), 'session-1');
    expect(result.content).toBe('Intent is: billing');
  });

  it('should throw FanOutPartialError when a fan-out node fails', async () => {
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
      nodeResult('B succeeded', terminal())
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

    try {
      await orchestrator.run(msg('Start'), 'session-1');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(FanOutPartialError);
      const error = e as FanOutPartialError;
      expect(error.fulfilled).toHaveLength(1);
      expect(error.fulfilled[0].output.content).toBe('B succeeded');
      expect(error.rejected).toHaveLength(1);
      expect(error.rejected[0].nodeName).toBe('nodeC');
      expect(error.rejected[0].error.message).toBe('C failed');
    }
  });

  it('should create a fresh SharedContext per run', async () => {
    let capturedContext2: Agent.SharedContextInterface | null = null;
    let callCount = 0;

    const nodeA = stubNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      async (_msg, sharedContext) => {
        callCount++;
        if (callCount === 1) {
          sharedContext.set('run', 1);
        } else {
          capturedContext2 = sharedContext;
        }
        return nodeResult('Done', terminal());
      }
    );

    const orchestrator = new OrchestratorBuilder().addNode(nodeA).setEntry('nodeA').build();

    await orchestrator.run(msg('First'), 'session-1');
    await orchestrator.run(msg('Second'), 'session-2');

    expect(capturedContext2!.get('run')).toBeUndefined();
  });

  it('should use externalContext when provided instead of creating a new one', async () => {
    const externalContext = new SharedContext('session-1');
    externalContext.set('injected', 'from-outside');

    let capturedValue: unknown;

    const nodeA = stubNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      async (_msg, sharedContext) => {
        capturedValue = sharedContext.get('injected');
        sharedContext.set('internal', 'from-inside');
        return nodeResult('Done', terminal());
      }
    );

    const orchestrator = new OrchestratorBuilder().addNode(nodeA).setEntry('nodeA').build();

    await orchestrator.run(msg('Start'), 'session-1', externalContext);

    expect(capturedValue).toBe('from-outside');
    expect(externalContext.get('internal')).toBe('from-inside');
  });

  it('should retry a node when retry policy is configured', async () => {
    let callCount = 0;
    const nodeA = stubNode('nodeA', [{ name: 'done', description: 'Terminal', target: null }], async () => {
      callCount++;
      if (callCount < 3) throw new Error('transient');
      return nodeResult('Success after retries', terminal());
    });

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA, { retry: { maxRetries: 3, delayMs: 1 } })
      .setEntry('nodeA')
      .build();

    const result = await orchestrator.run(msg('Start'), 'session-1');
    expect(result.content).toBe('Success after retries');
    expect(callCount).toBe(3);
  });

  it('should throw NodeRetryExhaustedError when retries exhausted', async () => {
    const nodeA = stubNode('nodeA', [{ name: 'done', description: 'Terminal', target: null }], async () => {
      throw new Error('always fails');
    });

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA, { retry: { maxRetries: 2, delayMs: 1 } })
      .setEntry('nodeA')
      .build();

    await expect(orchestrator.run(msg('Start'), 'session-1')).rejects.toThrow(NodeRetryExhaustedError);
  });

  it('should throw NodeTimeoutError when timeout policy is exceeded', async () => {
    const slowNode = stubNode('slowNode', [{ name: 'done', description: 'Terminal', target: null }], async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return nodeResult('Too late', terminal());
    });

    const orchestrator = new OrchestratorBuilder()
      .addNode(slowNode, { timeout: { timeoutMs: 10 } })
      .setEntry('slowNode')
      .build();

    await expect(orchestrator.run(msg('Start'), 'session-1')).rejects.toThrow(NodeTimeoutError);
  });

  it('should compose timeout per attempt with retry', async () => {
    let callCount = 0;
    const nodeA = stubNode('nodeA', [{ name: 'done', description: 'Terminal', target: null }], async () => {
      callCount++;
      if (callCount < 3) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return nodeResult('Success', terminal());
    });

    const orchestrator = new OrchestratorBuilder()
      .addNode(nodeA, { retry: { maxRetries: 3, delayMs: 1 }, timeout: { timeoutMs: 10 } })
      .setEntry('nodeA')
      .build();

    const result = await orchestrator.run(msg('Start'), 'session-1');
    expect(result.content).toBe('Success');
    expect(callCount).toBe(3);
  });

  it('should work unchanged when node has no policies', async () => {
    const nodeA = staticNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('No policy', terminal())
    );

    const orchestrator = new OrchestratorBuilder().addNode(nodeA).setEntry('nodeA').build();

    const result = await orchestrator.run(msg('Start'), 'session-1');
    expect(result.content).toBe('No policy');
  });

  describe('cancellation', () => {
    it('should abort the timed-out attempt before retrying, so its LLM call is cancelled', async () => {
      const signals: AbortSignal[] = [];
      const nodeA = stubNode('nodeA', [{ name: 'done', description: 'Terminal', target: null }], async (...args) => {
        const signal = args[3]?.signal;
        if (signal) signals.push(signal);
        if (signals.length === 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        return nodeResult('Second attempt', terminal());
      });

      const orchestrator = new OrchestratorBuilder()
        .addNode(nodeA, { retry: { maxRetries: 1, delayMs: 1 }, timeout: { timeoutMs: 10 } })
        .setEntry('nodeA')
        .build();

      const result = await orchestrator.run(msg('Start'), 'session-1');

      expect(result.content).toBe('Second attempt');
      expect(signals).toHaveLength(2);
      expect(signals[0].aborted).toBe(true);
      expect(signals[0].reason).toBeInstanceOf(NodeTimeoutError);
      expect(signals[1].aborted).toBe(false);
    });

    it('should pass the run signal to nodes without policies', async () => {
      const nodeA = staticNode(
        'nodeA',
        [{ name: 'done', description: 'Terminal', target: null }],
        nodeResult('Done', terminal())
      );
      const orchestrator = new OrchestratorBuilder().addNode(nodeA).setEntry('nodeA').build();
      const controller = new AbortController();

      await orchestrator.run(msg('Start'), 'session-1', undefined, { signal: controller.signal });

      expect(nodeA.run).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'session-1', {
        signal: controller.signal
      });
    });

    it('should start no further node after the run is cancelled', async () => {
      const controller = new AbortController();
      const nodeA = stubNode('nodeA', [{ name: 'next', description: 'Go to B', target: 'nodeB' }], async () => {
        controller.abort();
        return nodeResult('From A', single('nodeB'));
      });
      const nodeB = staticNode(
        'nodeB',
        [{ name: 'done', description: 'Terminal', target: null }],
        nodeResult('From B', terminal())
      );
      const orchestrator = new OrchestratorBuilder().addNode(nodeA).addNode(nodeB).setEntry('nodeA').build();

      await expect(
        orchestrator.run(msg('Start'), 'session-1', undefined, { signal: controller.signal })
      ).rejects.toThrow();
      expect(nodeB.run).not.toHaveBeenCalled();
    });

    it('should abort a timed-out node when the run is cancelled', async () => {
      const controller = new AbortController();
      let nodeSignal: AbortSignal | undefined;
      const nodeA = stubNode('nodeA', [{ name: 'done', description: 'Terminal', target: null }], (...args) => {
        nodeSignal = args[3]?.signal;
        return new Promise((_resolve, reject) => {
          nodeSignal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      });
      const orchestrator = new OrchestratorBuilder()
        .addNode(nodeA, { timeout: { timeoutMs: 1000 } })
        .setEntry('nodeA')
        .build();

      const run = orchestrator.run(msg('Start'), 'session-1', undefined, { signal: controller.signal });
      controller.abort();

      await expect(run).rejects.toThrow('aborted');
      expect(nodeSignal?.aborted).toBe(true);
    });
  });
});
