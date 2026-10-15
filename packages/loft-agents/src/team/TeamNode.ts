import { Agent } from '@moc-global/loft-definitions';

import { Orchestrator } from '../core/Orchestrator';
import { SharedContext } from '../core/SharedContext';
import { InvalidGraphError } from '../errors';

const TEAM_SYSTEM_PROMPT_KEY = '__team.systemPrompt';

export class TeamNode implements Agent.Node {
  public readonly name: string;
  public readonly transitions: Agent.TransitionDef[];

  private readonly orchestrator: Orchestrator;
  private readonly systemPrompt?: string;

  constructor(config: {
    name: string;
    orchestrator: Orchestrator;
    transitions: Agent.TransitionDef[];
    systemPrompt?: string;
  }) {
    this.name = config.name;
    this.orchestrator = config.orchestrator;
    this.transitions = config.transitions;
    this.systemPrompt = config.systemPrompt;
  }

  async run(
    message: Agent.AgentMessage,
    parentContext: Agent.SharedContextInterface,
    sessionId: string,
    options?: Agent.NodeRunOptions
  ): Promise<Agent.NodeResult> {
    // The team runs its own internal orchestrator with a fresh SharedContext.
    // Parent data is copied in (read-only snapshot) so team nodes can access
    // upstream results.  After the team finishes, any NEW keys produced inside
    // the team are propagated back to the parent under a "team:<name>" namespace
    // to avoid key collisions.
    const internalContext = new SharedContext(sessionId);

    // Seed internal context with a snapshot of the parent data
    for (const key of parentContext.keys()) {
      internalContext.set(key, parentContext.get(key));
    }

    if (this.systemPrompt) {
      internalContext.set(TEAM_SYSTEM_PROMPT_KEY, this.systemPrompt);
    }

    const parentKeysBefore = new Set(parentContext.keys());
    const output = await this.orchestrator.run(message, sessionId, internalContext, { signal: options?.signal });

    // Propagate new keys produced by the team back to the parent context
    for (const key of internalContext.keys()) {
      if (!parentKeysBefore.has(key) && key !== TEAM_SYSTEM_PROMPT_KEY) {
        parentContext.set(`team:${this.name}:${key}`, internalContext.get(key));
      }
    }

    const transition = this.resolveTransition();

    return { output, transition };
  }

  private resolveTransition(): Agent.Transition {
    if (this.transitions.length === 0) {
      return { type: Agent.TransitionType.TERMINAL };
    }
    if (this.transitions.length === 1) {
      const def = this.transitions[0];
      if (def.target === null) {
        return { type: Agent.TransitionType.TERMINAL };
      }
      return { type: Agent.TransitionType.SINGLE, target: def.target };
    }
    throw new InvalidGraphError(
      `Ambiguous transition: team '${this.name}' has ${this.transitions.length} outgoing transitions but no transitionResolver was provided`
    );
  }
}
