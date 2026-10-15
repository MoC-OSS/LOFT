// Flow 1: Simple — single agent, TERMINAL transition
// "What wine goes with salmon?" → sommelier answers directly

import { LOFT } from '@moc-global/loft';
import { LoftAgentNode } from '@moc-global/loft-agents';
import { Chat } from '@moc-global/loft-definitions';

import { MODEL_NAME } from '../../shared/setup';

export function createSommelier(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'sommelier',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'sommelier',
    transitions: [] // no transitions = TERMINAL
  });
}
