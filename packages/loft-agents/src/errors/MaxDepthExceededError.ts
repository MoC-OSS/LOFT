import { AgentError } from './AgentError';

export class MaxDepthExceededError extends AgentError {
  constructor(public readonly maxDepth: number) {
    super(`Max execution depth exceeded: ${maxDepth}`);
    this.name = 'MaxDepthExceededError';
  }
}
