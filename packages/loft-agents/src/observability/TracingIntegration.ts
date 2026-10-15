import { Agent, Strategy } from '@moc-global/loft-definitions';

export function createOrchestratorSpan(
  tracer: Strategy.Tracer.Tracer,
  message: Agent.AgentMessage,
  sessionId: string
): Strategy.Tracer.Span {
  return tracer.span({
    name: 'orchestrator.run',
    input: { message: message.content, sessionId },
    metadata: { component: 'loft-agents' }
  });
}

export function createNodeSpan(
  parentSpan: Strategy.Tracer.Span,
  nodeName: string,
  message: Agent.AgentMessage
): Strategy.Tracer.Span {
  return parentSpan.span({
    name: `node.${nodeName}`,
    input: { message: message.content }
  });
}

export function createFanOutSpan(parentSpan: Strategy.Tracer.Span, targets: string[]): Strategy.Tracer.Span {
  return parentSpan.span({
    name: 'orchestrator.fanOut',
    input: { targets }
  });
}

export function logRetryEvent(
  parentSpan: Strategy.Tracer.Span,
  nodeName: string,
  attempt: number,
  error: Error,
  delayMs: number
): void {
  parentSpan.event({
    name: 'node.retry',
    input: { nodeName, attempt, error: error.message, delayMs },
    level: 'WARNING'
  });
}
