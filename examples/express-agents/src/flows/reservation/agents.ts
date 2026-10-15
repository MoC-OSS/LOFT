// Flow 6: Reservation — Focus with dynamic fields + custom non-LLM Node + ScopedContext
// "Book a table for 4" → Focus intake (resolveFields) → availability check (custom Node) → confirmation
//
// This flow demonstrates three features not covered by other flows:
// 1. resolveFields — dynamically adds occasion_type when special_occasion is true
// 2. Custom Agent.Node — AvailabilityCheckNode has no LLM, pure computation
// 3. ScopedContext — availability node uses sharedContext.for('availability-check')

import { LOFT } from '@moc-global/loft';
import { LoftAgentNode } from '@moc-global/loft-agents';
import { Agent, Chat } from '@moc-global/loft-definitions';

import { MODEL_NAME } from '../../shared/setup';

// --- Focus config with resolveFields ---

export const RESERVATION_FOCUS_NAME = 'reservation-intake';

export const reservationFocus: Agent.Focus = {
  agentName: RESERVATION_FOCUS_NAME,
  prompt: 'Collect table reservation details through friendly conversation',
  fields: [
    { key: 'date', type: Agent.FocusFieldType.DATE, required: true, description: 'Reservation date' },
    { key: 'time', type: Agent.FocusFieldType.STRING, required: true, description: 'Preferred time (e.g. 19:00)' },
    {
      key: 'party_size',
      type: Agent.FocusFieldType.NUMBER,
      required: true,
      description: 'Number of guests (1-20)',
      validate: (v) => {
        const n = Number(v);
        return n >= 1 && n <= 20 ? true : 'Party size must be between 1 and 20';
      }
    },
    {
      key: 'outdoor_seating',
      type: Agent.FocusFieldType.BOOLEAN,
      required: true,
      default: false,
      description: 'Prefer outdoor seating?'
    },
    {
      key: 'special_occasion',
      type: Agent.FocusFieldType.BOOLEAN,
      required: true,
      default: false,
      description: 'Is this a special occasion?'
    }
  ],

  // Dynamic field resolution: when special_occasion is true, add occasion_type field
  resolveFields: ({ fields, filled }) => {
    if (filled.special_occasion === true) {
      const hasOccasionType = fields.some((f) => f.key === 'occasion_type');
      if (!hasOccasionType) {
        return [
          ...fields,
          {
            key: 'occasion_type',
            type: Agent.FocusFieldType.ENUM,
            values: ['birthday', 'anniversary', 'business', 'other'],
            required: true,
            description: 'Type of occasion'
          }
        ];
      }
    }
    return fields;
  },

  onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'availability-check' }
};

// --- Agents ---

export function createReservationIntake(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: RESERVATION_FOCUS_NAME,
    loft,
    llmName: MODEL_NAME,
    manifestName: 'reservation-intake',
    transitions: [{ name: 'collecting', description: 'Still collecting details', target: null }],
    focusName: RESERVATION_FOCUS_NAME,
    onFocusComplete: { type: Agent.FocusActionType.TRANSITION, target: 'availability-check' }
  });
}

// --- Custom Node (no LLM) ---
// Implements Agent.Node directly — demonstrates that the orchestrator is not limited to LLM nodes.
// Checks "availability" (simulated) and writes the result via ScopedContext.

export class AvailabilityCheckNode implements Agent.Node {
  readonly name = 'availability-check';
  readonly transitions: Agent.TransitionDef[] = [
    { name: 'to-confirmation', description: 'Proceed to confirmation', target: 'reservation-confirmation' }
  ];

  async run(
    message: Agent.AgentMessage,
    sharedContext: Agent.SharedContextInterface,
    _sessionId: string
  ): Promise<Agent.NodeResult> {
    // Read Focus data from shared context (written by LoftAgentNode when focus completes)
    const focusData = sharedContext.get<Record<string, unknown>>(`focus:${RESERVATION_FOCUS_NAME}`);

    // Use ScopedContext — writes are automatically prefixed with 'availability-check.'
    const scoped = sharedContext.for('availability-check');

    const partySize = Number(focusData?.party_size ?? 0);
    const outdoor = focusData?.outdoor_seating === true;
    const date = String(focusData?.date ?? '');

    // Simulated availability logic
    const isWeekend = this.isWeekendDate(date);
    const largeParty = partySize > 8;
    const available = !(isWeekend && largeParty && outdoor);

    scoped.set('available', available);
    scoped.set('partySize', partySize);
    scoped.set('outdoor', outdoor);
    scoped.set('isWeekend', isWeekend);

    if (!available) {
      scoped.set('alternative', 'Indoor seating is available for large weekend parties');
    }

    const summary = available
      ? `Table for ${partySize} on ${date} — confirmed${outdoor ? ' (outdoor)' : ''}.`
      : `Outdoor seating for ${partySize} on a weekend is unavailable. Indoor alternative offered.`;

    return {
      output: { role: Agent.AgentMessageRole.ASSISTANT, content: summary },
      transition: { type: Agent.TransitionType.SINGLE, target: 'reservation-confirmation' }
    };
  }

  private isWeekendDate(dateStr: string): boolean {
    try {
      // A date such as 2026-10-17 is parsed as UTC midnight; the local day can be the one before
      const day = new Date(dateStr).getUTCDay();
      return day === 0 || day === 6;
    } catch {
      return false;
    }
  }
}

export function createReservationConfirmation(loft: LOFT<Chat.ChatInterface>): LoftAgentNode {
  return new LoftAgentNode({
    name: 'reservation-confirmation',
    loft,
    llmName: MODEL_NAME,
    manifestName: 'reservation-confirmation',
    transitions: [] // TERMINAL
  });
}
