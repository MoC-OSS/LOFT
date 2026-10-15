import { Agent, Logger, Strategy } from '@moc-global/loft-definitions';

import { FanOutPartialError, FanOutRejection, MaxDepthExceededError, NodeNotFoundError } from '../errors';
import { MetricsCollector } from '../observability/Metrics';
import {
  createFanOutSpan,
  createNodeSpan,
  createOrchestratorSpan,
  logRetryEvent
} from '../observability/TracingIntegration';
import { withRetry } from '../policies/RetryPolicy';
import { withTimeout } from '../policies/TimeoutPolicy';
import { SharedContext } from './SharedContext';

export class Orchestrator {
  private readonly log = new Logger('Orchestrator');
  private readonly errorStrategy: Agent.ErrorStrategy;
  private readonly nodePolicies: Map<string, Agent.NodePolicy>;
  private readonly tracer?: Strategy.Tracer.Tracer;
  private readonly metricsCallback?: (metrics: Agent.OrchestratorMetrics) => void;
  private readonly cycleDetection: boolean;

  constructor(
    private readonly nodes: Map<string, Agent.Node>,
    private readonly entryNodeName: string,
    private readonly maxDepth: number,
    options?: Agent.OrchestratorOptions
  ) {
    this.errorStrategy = options?.errorStrategy ?? Agent.ErrorStrategy.FAIL_FAST;
    this.nodePolicies = options?.nodePolicies ?? new Map();
    this.tracer = options?.tracer;
    this.metricsCallback = options?.metricsCallback;
    this.cycleDetection = options?.cycleDetection ?? false;
  }

  async run(
    message: Agent.AgentMessage,
    sessionId: string,
    externalContext?: Agent.SharedContextInterface,
    options?: Agent.OrchestratorRunOptions
  ): Promise<Agent.AgentMessage> {
    return this.runFrom(this.entryNodeName, message, sessionId, externalContext, options);
  }

  async runFrom(
    startNodeName: string,
    message: Agent.AgentMessage,
    sessionId: string,
    externalContext?: Agent.SharedContextInterface,
    options?: Agent.OrchestratorRunOptions
  ): Promise<Agent.AgentMessage> {
    const signal = options?.signal;
    const sharedContext = externalContext ?? new SharedContext(sessionId);
    const metrics = this.metricsCallback ? new MetricsCollector() : undefined;
    const orchestratorSpan = this.tracer ? createOrchestratorSpan(this.tracer, message, sessionId) : undefined;
    const nodeSequence: string[] = [];
    let depth = 0;

    try {
      // Run start node
      signal?.throwIfAborted();
      const startNode = this.getNode(startNodeName);
      let result = await this.executeNode(
        startNode,
        message,
        sharedContext,
        sessionId,
        orchestratorSpan,
        metrics,
        nodeSequence,
        signal
      );
      depth++;

      // Transition loop
      while (result.transition.type !== Agent.TransitionType.TERMINAL) {
        if (depth >= this.maxDepth) {
          throw new MaxDepthExceededError(this.maxDepth);
        }

        // A cancelled run starts no further node
        signal?.throwIfAborted();

        if (result.transition.type === Agent.TransitionType.SINGLE) {
          const nextNode = this.getNode(result.transition.target);
          result = await this.executeNode(
            nextNode,
            result.output,
            sharedContext,
            sessionId,
            orchestratorSpan,
            metrics,
            nodeSequence,
            signal
          );
          depth++;
        } else if (result.transition.type === Agent.TransitionType.FAN_OUT) {
          result = await this.executeFanOut(
            result.transition.targets,
            result.output,
            sharedContext,
            sessionId,
            orchestratorSpan,
            metrics,
            nodeSequence,
            signal
          );
          depth++;
        }
      }

      orchestratorSpan?.end({ output: { message: result.output.content }, metadata: { depth, nodeSequence } });

      if (metrics && this.metricsCallback) {
        this.metricsCallback(metrics.finalize(depth));
      }

      return result.output;
    } catch (error) {
      orchestratorSpan?.end({
        metadata: { depth, nodeSequence, error: error instanceof Error ? error.message : String(error) },
        level: 'ERROR'
      });

      if (metrics && this.metricsCallback) {
        this.metricsCallback(metrics.finalize(depth));
      }

      throw error;
    }
  }

  private async executeFanOut(
    targets: string[],
    message: Agent.AgentMessage,
    sharedContext: Agent.SharedContextInterface,
    sessionId: string,
    orchestratorSpan?: Strategy.Tracer.Span,
    metrics?: MetricsCollector,
    nodeSequence?: string[],
    signal?: AbortSignal
  ): Promise<Agent.NodeResult> {
    const fanOutSpan = orchestratorSpan ? createFanOutSpan(orchestratorSpan, targets) : undefined;
    const nodes = targets.map((name) => ({ name, node: this.getNode(name) }));

    const settled = await Promise.allSettled(
      nodes.map(({ node }) =>
        this.executeNode(node, message, sharedContext, sessionId, fanOutSpan, metrics, nodeSequence, signal)
      )
    );

    const fulfilled: Agent.NodeResult[] = [];
    const rejected: FanOutRejection[] = [];

    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      if (outcome.status === 'fulfilled') {
        fulfilled.push(outcome.value);
      } else {
        rejected.push({
          nodeName: nodes[i].name,
          error: outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason))
        });
      }
    }

    if (rejected.length > 0) {
      if (this.errorStrategy === Agent.ErrorStrategy.CONTINUE && fulfilled.length > 0) {
        sharedContext.set(
          Agent.FANOUT_REJECTED_KEY,
          rejected.map((r) => ({ nodeName: r.nodeName, error: r.error.message }))
        );
        fanOutSpan?.end({
          metadata: { partial: true, rejected: rejected.map((r) => r.nodeName) },
          level: 'WARNING'
        });
      } else {
        fanOutSpan?.end({
          metadata: { rejected: rejected.map((r) => r.nodeName) },
          level: 'ERROR'
        });
        throw new FanOutPartialError(fulfilled, rejected);
      }
    } else {
      fanOutSpan?.end({ metadata: { targets } });
    }

    // Determine convergence
    const lastResult = fulfilled[fulfilled.length - 1];

    const singleTargets = fulfilled
      .filter((r) => r.transition.type === Agent.TransitionType.SINGLE)
      .map((r) => (r.transition as Agent.TransitionSingle).target);

    const uniqueTargets = [...new Set(singleTargets)];

    if (uniqueTargets.length === 1) {
      return {
        output: lastResult.output,
        transition: { type: Agent.TransitionType.SINGLE, target: uniqueTargets[0] }
      };
    }

    const allTerminal = fulfilled.every((r) => r.transition.type === Agent.TransitionType.TERMINAL);
    if (allTerminal) {
      return lastResult;
    }

    return lastResult;
  }

  private async executeNode(
    node: Agent.Node,
    message: Agent.AgentMessage,
    sharedContext: Agent.SharedContextInterface,
    sessionId: string,
    parentSpan?: Strategy.Tracer.Span,
    metrics?: MetricsCollector,
    nodeSequence?: string[],
    signal?: AbortSignal
  ): Promise<Agent.NodeResult> {
    const nodeSpan = parentSpan ? createNodeSpan(parentSpan, node.name, message) : undefined;
    metrics?.addTransitionPathEntry(node.name);
    metrics?.startNode(node.name);
    if (nodeSequence) {
      this.trackNode(node.name, nodeSequence);
    }

    const policy = this.nodePolicies.get(node.name);

    const baseFn = (nodeSignal: AbortSignal | undefined) =>
      node.run(message, sharedContext, sessionId, { signal: nodeSignal });

    try {
      let result: Agent.NodeResult;
      let retryCount = 0;

      if (!policy?.retry && !policy?.timeout) {
        result = await baseFn(signal);
      } else {
        // Each attempt gets its own deadline; a timeout aborts that attempt's LLM call before any retry
        const timeoutPolicy = policy.timeout;
        const timeoutWrapped = timeoutPolicy
          ? () => withTimeout((attemptSignal) => baseFn(attemptSignal), timeoutPolicy, node.name, signal)
          : () => baseFn(signal);

        if (policy.retry) {
          const retryCallback = nodeSpan
            ? (attempt: number, error: Error, delayMs: number) =>
                logRetryEvent(nodeSpan, node.name, attempt, error, delayMs)
            : undefined;
          const retryResult = await withRetry(timeoutWrapped, policy.retry, node.name, retryCallback, signal);
          result = retryResult.result;
          retryCount = retryResult.retryCount;
        } else {
          result = await timeoutWrapped();
        }
      }

      metrics?.endNode(node.name, retryCount);

      // Check NodeMetricsAware
      if (metrics && 'getLastMetrics' in node) {
        const metricsAware = node as Agent.NodeMetricsAware;
        const nodeMetrics = metricsAware.getLastMetrics();
        if (nodeMetrics) {
          metrics.recordUsage(node.name, nodeMetrics.usage);
        }
      }
      nodeSpan?.end({
        output: { message: result.output.content, transition: result.transition.type },
        metadata: { nodeName: node.name }
      });

      return result;
    } catch (error) {
      metrics?.endNode(node.name, 0, error instanceof Error ? error : new Error(String(error)));
      nodeSpan?.end({
        metadata: { nodeName: node.name, error: error instanceof Error ? error.message : String(error) },
        level: 'ERROR'
      });
      throw error;
    }
  }

  private trackNode(nodeName: string, sequence: string[]): void {
    sequence.push(nodeName);
    if (this.cycleDetection) {
      this.detectCycle(sequence);
    }
  }

  private static readonly MAX_CYCLE_PATTERN_LENGTH = 10;

  private detectCycle(sequence: string[]): void {
    const len = sequence.length;
    const maxPattern = Math.min(Orchestrator.MAX_CYCLE_PATTERN_LENGTH, Math.floor(len / 2));
    for (let patternLen = 2; patternLen <= maxPattern; patternLen++) {
      const pattern = sequence.slice(len - patternLen);
      const previous = sequence.slice(len - patternLen * 2, len - patternLen);
      if (pattern.length === previous.length && pattern.every((name, i) => name === previous[i])) {
        this.log.warn(`Cycle detected: ${pattern.join(' → ')} repeated in node sequence`);
        return;
      }
    }
  }

  private getNode(name: string): Agent.Node {
    const node = this.nodes.get(name);
    if (!node) {
      throw new NodeNotFoundError(name);
    }
    return node;
  }
}
