import { AgentError } from './AgentError';

export class NodeTimeoutError extends AgentError {
  constructor(
    public readonly nodeName: string,
    public readonly timeoutMs: number
  ) {
    super(`Node '${nodeName}' timed out after ${timeoutMs}ms`);
    this.name = 'NodeTimeoutError';
  }
}
