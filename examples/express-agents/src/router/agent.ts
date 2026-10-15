// Router agent — classifies user intent and dispatches to the appropriate flow.
// Uses a custom TransitionResolver that parses [ROUTE:flow-name] from the LLM response.
// The router manifest instructs the LLM to always include this tag.

import { LOFT } from '@moc-global/loft';
import { LoftAgentNode } from '@moc-global/loft-agents';
import { Agent, Chat, Type } from '@moc-global/loft-definitions';

import { MODEL_NAME } from '../shared/setup';

const FLOW_TARGETS = [
  'sommelier',
  'nutritionist',
  'catering-dispatcher',
  'restaurant-visit',
  'banquet-intake',
  'reservation-intake'
];

const routerTransitionResolver: Agent.TransitionResolver = (result, transitions) => {
  const text = result.messages.llmResponse.topChoice.content
    .filter((c): c is Type.Entity.TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('');

  const match = text.match(/\[ROUTE:(\S+)\]/);
  const target = match?.[1];

  if (target) {
    const validTransition = transitions.find((t) => t.target === target);
    if (validTransition) {
      return { type: Agent.TransitionType.SINGLE, target: validTransition.target! };
    }
  }

  // Fallback: simple flow
  return { type: Agent.TransitionType.SINGLE, target: 'sommelier' };
};

export function createRouter(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'router',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'router',
    transitions: FLOW_TARGETS.map((target) => ({
      name: `to-${target}`,
      description: `Route to ${target}`,
      target
    })),
    transitionResolver: routerTransitionResolver
  });
}
