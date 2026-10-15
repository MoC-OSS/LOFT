// Flow 3: Parallel — FAN_OUT to 3 specialists, then converge
// "Organize catering for 50 people" → dispatcher → [appetizers | mains | desserts] → coordinator
//
// dispatcher uses a deterministic TransitionResolver (no LLM decision needed).
// Three specialists run in parallel via FAN_OUT.
// coordinator merges all results into a unified catering plan.

import { LOFT } from '@moc-global/loft';
import { LoftAgentNode } from '@moc-global/loft-agents';
import { Agent, Chat } from '@moc-global/loft-definitions';

import { MODEL_NAME } from '../../shared/setup';

// Deterministic fan-out — always dispatches to all 3 specialists
const fanOutResolver: Agent.TransitionResolver = () => ({
  type: Agent.TransitionType.FAN_OUT,
  targets: ['appetizers-specialist', 'mains-specialist', 'desserts-specialist']
});

export function createCateringDispatcher(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'catering-dispatcher',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'catering-dispatcher',
    transitions: [
      { name: 'appetizers', description: 'Appetizers specialist', target: 'appetizers-specialist' },
      { name: 'mains', description: 'Main courses specialist', target: 'mains-specialist' },
      { name: 'desserts', description: 'Desserts specialist', target: 'desserts-specialist' }
    ],
    transitionResolver: fanOutResolver
  });
}

export function createAppetizersSpecialist(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'appetizers-specialist',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'appetizers-specialist',
    transitions: [{ name: 'to-coordinator', description: 'Send to coordinator', target: 'catering-coordinator' }]
  });
}

export function createMainsSpecialist(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'mains-specialist',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'mains-specialist',
    transitions: [{ name: 'to-coordinator', description: 'Send to coordinator', target: 'catering-coordinator' }]
  });
}

export function createDessertsSpecialist(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'desserts-specialist',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'desserts-specialist',
    transitions: [{ name: 'to-coordinator', description: 'Send to coordinator', target: 'catering-coordinator' }]
  });
}

export function createCateringCoordinator(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'catering-coordinator',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'catering-coordinator',
    transitions: [] // TERMINAL
  });
}
