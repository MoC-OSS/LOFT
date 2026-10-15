import { AgentError } from './AgentError';

export class NodeRetryExhaustedError extends AgentError {
  constructor(
    public readonly nodeName: string,
    public readonly maxRetries: number,
    public readonly lastError: Error
  ) {
    super(`Node '${nodeName}' failed after ${maxRetries} retries: ${lastError.message}`);
    this.name = 'NodeRetryExhaustedError';
  }
}
