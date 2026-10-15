import { AgentError } from './AgentError';

export class NodeNotFoundError extends AgentError {
  constructor(public readonly nodeName: string) {
    super(`Node not found: '${nodeName}'`);
    this.name = 'NodeNotFoundError';
  }
}
