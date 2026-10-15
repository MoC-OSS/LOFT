// Flow 5: Full — Focus + FAN_OUT + Team + retry + timeout + tracing + metrics
// "Organize a banquet" → multi-turn Focus collection → dispatcher →
// [venue | menu | entertainment] → planning-team → proposal
//
// This flow demonstrates ALL orchestration features working together.

import { LOFT } from '@moc-global/loft';
import { LoftAgentNode, TeamBuilder } from '@moc-global/loft-agents';
import { Agent, Chat } from '@moc-global/loft-definitions';

import { MODEL_NAME } from '../../shared/setup';

// --- Focus config ---

export const BANQUET_FOCUS_NAME = 'banquet-intake';

export const banquetFocus: Agent.Focus = {
  agentName: BANQUET_FOCUS_NAME,
  prompt: 'Collect banquet event details from the user through natural conversation',
  fields: [
    { key: 'event_date', type: Agent.FocusFieldType.DATE, required: true, description: 'Event date' },
    {
      key: 'guest_count',
      type: Agent.FocusFieldType.NUMBER,
      required: true,
      description: 'Number of guests (1-500)',
      validate: (v) => {
        const n = Number(v);
        return n >= 1 && n <= 500 ? true : 'Guest count must be between 1 and 500';
      }
    },
    {
      key: 'budget',
      type: Agent.FocusFieldType.NUMBER,
      required: true,
      description: 'Budget in USD',
      validate: (v) => (Number(v) > 0 ? true : 'Budget must be positive')
    },
    {
      key: 'cuisine_preference',
      type: Agent.FocusFieldType.ENUM,
      required: true,
      values: ['italian', 'french', 'asian', 'mixed'],
      description: 'Preferred cuisine style'
    },
    {
      key: 'venue_preference',
      type: Agent.FocusFieldType.ENUM,
      required: true,
      values: ['indoor', 'outdoor', 'both'],
      description: 'Venue preference'
    },
    {
      key: 'dietary_restrictions',
      type: Agent.FocusFieldType.STRING,
      required: false,
      description: 'Any dietary restrictions or allergies'
    },
    {
      key: 'needs_accessibility',
      type: Agent.FocusFieldType.BOOLEAN,
      required: false,
      default: false,
      description: 'Wheelchair-accessible venue needed?'
    }
  ],
  onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'banquet-dispatcher' }
};

// --- Agents ---

export function createBanquetIntake(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: BANQUET_FOCUS_NAME,
    loft,
    llmName: MODEL_NAME,
    manifestName: 'banquet-intake',
    transitions: [{ name: 'collecting', description: 'Still collecting details', target: null }],
    focusName: BANQUET_FOCUS_NAME,
    onFocusComplete: { type: Agent.FocusActionType.TRANSITION, target: 'banquet-dispatcher' }
  });
}

// Deterministic fan-out to venue + menu + entertainment
const banquetFanOutResolver: Agent.TransitionResolver = () => ({
  type: Agent.TransitionType.FAN_OUT,
  targets: ['venue-finder', 'menu-planner', 'entertainment-finder']
});

export function createBanquetDispatcher(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'banquet-dispatcher',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'banquet-dispatcher',
    transitions: [
      { name: 'venue', description: 'Venue search', target: 'venue-finder' },
      { name: 'menu', description: 'Menu planning', target: 'menu-planner' },
      { name: 'entertainment', description: 'Entertainment search', target: 'entertainment-finder' }
    ],
    transitionResolver: banquetFanOutResolver
  });
}

export function createVenueFinder(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'venue-finder',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'venue-finder',
    transitions: [{ name: 'to-planning', description: 'Send to planning team', target: 'banquet-planning-team' }]
  });
}

export function createMenuPlanner(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'menu-planner',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'menu-planner',
    transitions: [{ name: 'to-planning', description: 'Send to planning team', target: 'banquet-planning-team' }]
  });
}

export function createEntertainmentFinder(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'entertainment-finder',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'entertainment-finder',
    transitions: [{ name: 'to-planning', description: 'Send to planning team', target: 'banquet-planning-team' }]
  });
}

export function createBanquetPlanningTeam(loft: LOFT<Chat.ChatInterface>) {
  const planner = new LoftAgentNode({
    name: 'banquet-planner',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'banquet-planner',
    transitions: [{ name: 'to-budget', description: 'Pass to budget optimizer', target: 'budget-optimizer' }]
  });

  const budgetOptimizer = new LoftAgentNode({
    name: 'budget-optimizer',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'budget-optimizer',
    transitions: [] // TERMINAL within team
  });

  return new TeamBuilder('banquet-planning-team')
    .systemPrompt('You are a banquet planning team. Create a detailed event plan within budget.')
    .addNode(planner)
    .addNode(budgetOptimizer)
    .setEntry('banquet-planner')
    .setMaxDepth(5)
    .addTransition({ name: 'to-proposal', description: 'Send to proposal writer', target: 'proposal-writer' })
    .build();
}

export function createProposalWriter(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'proposal-writer',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'proposal-writer',
    transitions: [] // TERMINAL
  });
}
