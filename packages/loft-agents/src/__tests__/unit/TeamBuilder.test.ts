import { describe, expect, it } from 'vitest';

import { SharedContext } from '../../core/SharedContext';
import { InvalidGraphError, NoEntryNodeError } from '../../errors';
import { TeamBuilder } from '../../team/TeamBuilder';
import { msg, nodeResult, single, staticNode, stubNode, terminal } from '../helpers';

describe('TeamBuilder', () => {
  it('should build a valid team with child nodes, entry, and outgoing transition', () => {
    const nodeA = staticNode(
      'nodeA',
      [{ name: 'next', description: 'Go to B', target: 'nodeB' }],
      nodeResult('A', single('nodeB'))
    );
    const nodeB = staticNode(
      'nodeB',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('B', terminal())
    );

    const team = new TeamBuilder('my-team')
      .addNode(nodeA)
      .addNode(nodeB)
      .setEntry('nodeA')
      .addTransition({ name: 'done', description: 'Team complete', target: 'nextNode' })
      .build();

    expect(team.name).toBe('my-team');
    expect(team.transitions).toHaveLength(1);
    expect(team.transitions[0].target).toBe('nextNode');
  });

  it('should reject missing entry node', () => {
    const nodeA = staticNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('A', terminal())
    );

    expect(() => new TeamBuilder('team').addNode(nodeA).build()).toThrow(NoEntryNodeError);
  });

  it('should reject invalid transition target in child graph', () => {
    const nodeA = staticNode(
      'nodeA',
      [{ name: 'next', description: 'Go to missing', target: 'nodeB' }],
      nodeResult('A', single('nodeB'))
    );

    expect(() => new TeamBuilder('team').addNode(nodeA).setEntry('nodeA').build()).toThrow(InvalidGraphError);
  });

  it('should reject duplicate child node names', () => {
    const nodeA1 = staticNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('A1', terminal())
    );
    const nodeA2 = staticNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('A2', terminal())
    );

    expect(() => new TeamBuilder('team').addNode(nodeA1).addNode(nodeA2).setEntry('nodeA').build()).toThrow(
      InvalidGraphError
    );
  });

  it('should allow zero outgoing transitions when internal flow is fully terminal', () => {
    const nodeA = staticNode(
      'nodeA',
      [{ name: 'done', description: 'Terminal', target: null }],
      nodeResult('Done', terminal())
    );

    const team = new TeamBuilder('team').addNode(nodeA).setEntry('nodeA').build();

    expect(team.name).toBe('team');
    expect(team.transitions).toHaveLength(0);
  });

  it('should build and execute nested team with context propagation', async () => {
    let innerCapturedKeys: string[] = [];
    let outerCapturedKeys: string[] = [];

    const innerNode = stubNode(
      'innerNode',
      [{ name: 'done', description: 'Terminal', target: null }],
      async (_msg, sharedContext) => {
        sharedContext.set('inner-key', 'inner-value');
        innerCapturedKeys = sharedContext.keys();
        return nodeResult('Inner done', terminal());
      }
    );

    const innerTeam = new TeamBuilder('inner-team')
      .addNode(innerNode)
      .setEntry('innerNode')
      .addTransition({ name: 'done', description: 'Done', target: null })
      .build();

    const outerNode = stubNode(
      'outerNode',
      [{ name: 'toInner', description: 'Go to inner', target: 'inner-team' }],
      async (_msg, sharedContext) => {
        sharedContext.set('outer-key', 'outer-value');
        outerCapturedKeys = sharedContext.keys();
        return nodeResult('Outer done', single('inner-team'));
      }
    );

    const outerTeam = new TeamBuilder('outer-team').addNode(outerNode).addNode(innerTeam).setEntry('outerNode').build();

    const parentContext = new SharedContext('session-1');
    parentContext.set('parent-key', 'parent-value');

    await outerTeam.run(msg('Start'), parentContext, 'session-1');

    // Parent receives namespaced keys from outer team
    expect(parentContext.get('parent-key')).toBe('parent-value');
    expect(parentContext.get('team:outer-team:outer-key')).toBe('outer-value');
    // Inner team keys are double-namespaced
    expect(parentContext.get('team:outer-team:team:inner-team:inner-key')).toBe('inner-value');

    // Outer team saw parent data + its own keys
    expect(outerCapturedKeys).toContain('parent-key');
    expect(outerCapturedKeys).toContain('outer-key');

    // Inner team saw outer team's data (including parent snapshot) + its own keys
    expect(innerCapturedKeys).toContain('inner-key');
    expect(innerCapturedKeys).toContain('parent-key');
    expect(innerCapturedKeys).toContain('outer-key');
  });
});
