import { Agent } from '@moc-global/loft-definitions';

export class MetricsCollector {
  private readonly orchestratorStart: number;
  private readonly transitionPath: string[] = [];
  private readonly nodeStarts = new Map<string, number>();
  private readonly nodeMetrics: Agent.NodeMetrics[] = [];
  private readonly nodeIndexes = new Map<string, number>();

  constructor() {
    this.orchestratorStart = Date.now();
  }

  addTransitionPathEntry(nodeName: string): void {
    this.transitionPath.push(nodeName);
  }

  startNode(nodeName: string): void {
    this.nodeStarts.set(nodeName, Date.now());
  }

  endNode(nodeName: string, retryCount: number, error?: Error): void {
    const start = this.nodeStarts.get(nodeName) ?? Date.now();
    const index = this.nodeMetrics.length;
    this.nodeMetrics.push({
      nodeName,
      durationMs: Date.now() - start,
      retryCount,
      error
    });
    this.nodeIndexes.set(nodeName, index);
    this.nodeStarts.delete(nodeName);
  }

  recordUsage(nodeName: string, usage: Agent.NodeUsageMetrics): void {
    const index = this.nodeIndexes.get(nodeName);
    if (index !== undefined) {
      this.nodeMetrics[index].usage = usage;
    }
  }

  finalize(depthReached: number): Agent.OrchestratorMetrics {
    return {
      orchestratorDurationMs: Date.now() - this.orchestratorStart,
      transitionPath: [...this.transitionPath],
      depthReached,
      nodeMetrics: [...this.nodeMetrics]
    };
  }
}
