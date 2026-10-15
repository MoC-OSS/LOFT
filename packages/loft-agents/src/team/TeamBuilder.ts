import { Agent } from '@moc-global/loft-definitions';

import { OrchestratorBuilder } from '../core/OrchestratorBuilder';
import { TeamNode } from './TeamNode';

export class TeamBuilder {
  private readonly teamName: string;
  private readonly orchestratorBuilder = new OrchestratorBuilder();
  private readonly outgoingTransitions: Agent.TransitionDef[] = [];
  private teamSystemPrompt?: string;

  constructor(name: string) {
    this.teamName = name;
  }

  systemPrompt(prompt: string): this {
    this.teamSystemPrompt = prompt;
    return this;
  }

  addNode(node: Agent.Node): this {
    this.orchestratorBuilder.addNode(node);
    return this;
  }

  setEntry(nodeName: string): this {
    this.orchestratorBuilder.setEntry(nodeName);
    return this;
  }

  setMaxDepth(n: number): this {
    this.orchestratorBuilder.setMaxDepth(n);
    return this;
  }

  addTransition(def: Agent.TransitionDef): this {
    this.outgoingTransitions.push(def);
    return this;
  }

  build(): TeamNode {
    const orchestrator = this.orchestratorBuilder.build();

    return new TeamNode({
      name: this.teamName,
      orchestrator,
      transitions: this.outgoingTransitions,
      systemPrompt: this.teamSystemPrompt
    });
  }
}
