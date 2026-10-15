import { Agent } from '@moc-global/loft-definitions';
import { describe, expect, it } from 'vitest';

import { SharedContext } from '../../core/SharedContext';
import { InvalidGraphError, MaxDepthExceededError } from '../../errors';
import { TeamBuilder } from '../../team/TeamBuilder';
import { msg, nodeResult, single, staticNode, stubNode, terminal } from '../helpers';

describe('TeamNode', () => {
  it('should run internal 2-node sequential flow and return final output', async () => {
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

    const team = new TeamBuilder('review-team')
      .addNode(nodeA)
      .addNode(nodeB)
      .setEntry('nodeA')
      .addTransition({ name: 'done', description: 'Team done', target: 'nextNode' })
      .build();

    const parentContext = new SharedContext('session-1');
    const result = await team.run(msg('Start'), parentContext, 'session-1');

    expect(result.output.content).toBe('From B');
    expect(nodeA.run).toHaveBeenCalledOnce();
    expect(nodeB.run).toHaveBeenCalledOnce();
  });

  it('should propagate new team keys back to parent under team namespace', async () => {
    const nodeA = stubNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      async (_msg, sharedContext) => {
        sharedContext.set('internal-key', 'internal-value');
        return nodeResult('Done', terminal());
      }
    );

    const team = new TeamBuilder('my-team').addNode(nodeA).setEntry('nodeA').build();

    const parentContext = new SharedContext('session-1');
    parentContext.set('parent-key', 'parent-value');

    await team.run(msg('Start'), parentContext, 'session-1');

    // Parent key preserved
    expect(parentContext.get('parent-key')).toBe('parent-value');
    // New team key propagated under namespace
    expect(parentContext.get('team:my-team:internal-key')).toBe('internal-value');
    // Raw internal key NOT written directly to parent
    expect(parentContext.get('internal-key')).toBeUndefined();
  });

  it('should expose parent SharedContext data to internal nodes as read-only snapshot', async () => {
    let capturedParentValue: unknown;

    const nodeA = stubNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      async (_msg, sharedContext) => {
        capturedParentValue = sharedContext.get('parent-key');
        return nodeResult('Done', terminal());
      }
    );

    const team = new TeamBuilder('team').addNode(nodeA).setEntry('nodeA').build();

    const parentContext = new SharedContext('session-1');
    parentContext.set('parent-key', 'visible');

    await team.run(msg('Start'), parentContext, 'session-1');

    expect(capturedParentValue).toBe('visible');
  });

  it('should inject system prompt into internal SharedContext', async () => {
    let capturedSystemPrompt: unknown;

    const nodeA = stubNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      async (_msg, sharedContext) => {
        capturedSystemPrompt = sharedContext.get('__team.systemPrompt');
        return nodeResult('Done', terminal());
      }
    );

    const team = new TeamBuilder('team').systemPrompt('You are a review team').addNode(nodeA).setEntry('nodeA').build();

    const parentContext = new SharedContext('session-1');
    await team.run(msg('Start'), parentContext, 'session-1');

    expect(capturedSystemPrompt).toBe('You are a review team');
  });

  it('should not inject system prompt when not configured', async () => {
    let capturedKeys: string[] = [];

    const nodeA = stubNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      async (_msg, sharedContext) => {
        capturedKeys = sharedContext.keys();
        return nodeResult('Done', terminal());
      }
    );

    const team = new TeamBuilder('team').addNode(nodeA).setEntry('nodeA').build();

    const parentContext = new SharedContext('session-1');
    await team.run(msg('Start'), parentContext, 'session-1');

    expect(capturedKeys).not.toContain('__team.systemPrompt');
  });

  it('should return TransitionSingle with single outgoing transition', async () => {
    const nodeA = staticNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('Done', terminal())
    );

    const team = new TeamBuilder('team')
      .addNode(nodeA)
      .setEntry('nodeA')
      .addTransition({ name: 'next', description: 'Go next', target: 'nextNode' })
      .build();

    const result = await team.run(msg('Start'), new SharedContext('s1'), 's1');

    expect(result.transition).toEqual({ type: Agent.TransitionType.SINGLE, target: 'nextNode' });
  });

  it('should return TransitionTerminal with zero outgoing transitions', async () => {
    const nodeA = staticNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('Done', terminal())
    );

    const team = new TeamBuilder('team').addNode(nodeA).setEntry('nodeA').build();

    const result = await team.run(msg('Start'), new SharedContext('s1'), 's1');

    expect(result.transition).toEqual({ type: Agent.TransitionType.TERMINAL });
  });

  it('should throw InvalidGraphError with multiple outgoing transitions and no resolver', async () => {
    const nodeA = staticNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('Done', terminal())
    );

    const team = new TeamBuilder('team')
      .addNode(nodeA)
      .setEntry('nodeA')
      .addTransition({ name: 'a', description: 'Option A', target: 'targetA' })
      .addTransition({ name: 'b', description: 'Option B', target: 'targetB' })
      .build();

    await expect(team.run(msg('Start'), new SharedContext('s1'), 's1')).rejects.toThrow(InvalidGraphError);
  });

  it('should propagate internal orchestrator errors to caller', async () => {
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

    const team = new TeamBuilder('team').addNode(nodeA).addNode(nodeB).setEntry('nodeA').setMaxDepth(3).build();

    await expect(team.run(msg('Start'), new SharedContext('s1'), 's1')).rejects.toThrow(MaxDepthExceededError);
  });
});
