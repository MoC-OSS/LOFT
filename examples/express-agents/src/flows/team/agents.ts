// Flow 4: Team — TeamBuilder with encapsulated sub-graph
// "Review this restaurant" → visit → [review-team: food-critic + ambiance-critic] → verdict
//
// The review-team is a TeamNode — an isolated sub-graph.
// Parent context (visit impressions) is copied in as a read-only snapshot.
// Team results are propagated back under `team:review-team:` namespace.

import { LOFT } from '@moc-global/loft';
import { LoftAgentNode, TeamBuilder } from '@moc-global/loft-agents';
import { Chat } from '@moc-global/loft-definitions';

import { MODEL_NAME } from '../../shared/setup';

export function createVisitAgent(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'restaurant-visit',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'restaurant-visit',
    transitions: [{ name: 'to-review', description: 'Send to review team', target: 'review-team' }]
  });
}

export function createReviewTeam(loft: LOFT<Chat.ChatInterface>) {
  const foodCritic = new LoftAgentNode({
    name: 'food-critic',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'food-critic',
    transitions: [{ name: 'to-ambiance', description: 'Pass to ambiance critic', target: 'ambiance-critic' }]
  });

  const ambianceCritic = new LoftAgentNode({
    name: 'ambiance-critic',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'ambiance-critic',
    transitions: [] // TERMINAL within team
  });

  return new TeamBuilder('review-team')
    .systemPrompt('You are a restaurant review team. Evaluate the restaurant thoroughly.')
    .addNode(foodCritic)
    .addNode(ambianceCritic)
    .setEntry('food-critic')
    .setMaxDepth(5)
    .addTransition({ name: 'to-verdict', description: 'Send to verdict writer', target: 'verdict-writer' })
    .build();
}

export function createVerdictWriter(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'verdict-writer',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'verdict-writer',
    transitions: [] // TERMINAL
  });
}
