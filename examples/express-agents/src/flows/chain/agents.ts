// Flow 2: Chain — linear pipeline A → B → C
// "Plan a 3-course dinner" → nutritionist → chef → presenter
//
// Each agent reads SharedContext from the previous one.
// nutritionist writes dietary analysis → chef reads it and creates recipes →
// presenter reads everything and formats the final menu card.

import { LOFT } from '@moc-global/loft';
import { LoftAgentNode } from '@moc-global/loft-agents';
import { Chat } from '@moc-global/loft-definitions';

import { MODEL_NAME } from '../../shared/setup';

export function createNutritionist(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'nutritionist',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'nutritionist',
    transitions: [{ name: 'to-chef', description: 'Pass dietary analysis to chef', target: 'chef' }]
  });
}

export function createChef(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'chef',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'chef',
    transitions: [{ name: 'to-presenter', description: 'Pass recipes to presenter', target: 'presenter' }]
  });
}

export function createPresenter(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'presenter',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'presenter',
    transitions: [] // TERMINAL
  });
}
