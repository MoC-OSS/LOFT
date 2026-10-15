import { Agent, Logger, Strategy } from '@moc-global/loft-definitions';

import { InvalidGraphError, NodeNotFoundError, NoEntryNodeError } from '../errors';
import { Orchestrator } from './Orchestrator';

export class OrchestratorBuilder {
  private readonly log = new Logger('OrchestratorBuilder');
  private readonly nodes = new Map<string, Agent.Node>();
  private readonly nodePolicies = new Map<string, Agent.NodePolicy>();
  private entryNodeName: string | null = null;
  private maxDepth = parseInt(process.env.LOFT_AGENTS_MAX_DEPTH ?? '10', 10);
  private errorStrategy: Agent.ErrorStrategy = Agent.ErrorStrategy.FAIL_FAST;
  private tracer?: Strategy.Tracer.Tracer;
  private metricsCallback?: (metrics: Agent.OrchestratorMetrics) => void;
  private cycleDetection = false;

  addNode(node: Agent.Node, options?: Agent.NodePolicy): this {
    if (this.nodes.has(node.name)) {
      throw new InvalidGraphError(`Duplicate node name: '${node.name}'`);
    }
    this.nodes.set(node.name, node);
    if (options) {
      this.nodePolicies.set(node.name, options);
    }
    return this;
  }

  setErrorStrategy(strategy: Agent.ErrorStrategy): this {
    this.errorStrategy = strategy;
    return this;
  }

  setTracer(tracer: Strategy.Tracer.Tracer): this {
    this.tracer = tracer;
    return this;
  }

  setMetricsCallback(callback: (metrics: Agent.OrchestratorMetrics) => void): this {
    this.metricsCallback = callback;
    return this;
  }

  setCycleDetection(enabled: boolean): this {
    this.cycleDetection = enabled;
    return this;
  }

  setEntry(nodeName: string): this {
    this.entryNodeName = nodeName;
    return this;
  }

  setMaxDepth(n: number): this {
    this.maxDepth = n;
    return this;
  }

  build(): Orchestrator {
    this.validateEntryNode();
    this.validateTransitionTargets();
    this.warnUnreachableNodes();

    return new Orchestrator(this.nodes, this.entryNodeName!, this.maxDepth, {
      errorStrategy: this.errorStrategy,
      nodePolicies: this.nodePolicies,
      tracer: this.tracer,
      metricsCallback: this.metricsCallback,
      cycleDetection: this.cycleDetection
    });
  }

  private validateEntryNode(): void {
    if (!this.entryNodeName) {
      throw new NoEntryNodeError();
    }
    if (!this.nodes.has(this.entryNodeName)) {
      throw new NodeNotFoundError(this.entryNodeName);
    }
  }

  private validateTransitionTargets(): void {
    for (const [nodeName, node] of this.nodes) {
      for (const transition of node.transitions) {
        if (transition.target !== null && !this.nodes.has(transition.target)) {
          throw new InvalidGraphError(
            `Node '${nodeName}' has transition '${transition.name}' targeting non-existent node '${transition.target}'`
          );
        }
      }
    }
  }

  private warnUnreachableNodes(): void {
    const reachable = new Set<string>();
    const queue: string[] = [this.entryNodeName!];

    while (queue.length > 0) {
      const current = queue.pop()!;
      if (reachable.has(current)) continue;
      reachable.add(current);

      const node = this.nodes.get(current);
      if (!node) continue;

      for (const transition of node.transitions) {
        if (transition.target !== null && !reachable.has(transition.target)) {
          queue.push(transition.target);
        }
      }
    }

    for (const nodeName of this.nodes.keys()) {
      if (!reachable.has(nodeName)) {
        this.log.warn(`Node '${nodeName}' is unreachable from entry node '${this.entryNodeName}'`);
      }
    }
  }
}
