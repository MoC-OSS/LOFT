import { AgentError } from './AgentError';

export class InvalidGraphError extends AgentError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGraphError';
  }
}
