import { AgentError } from './AgentError';

export class NoEntryNodeError extends AgentError {
  constructor() {
    super('No entry node configured. Call setEntry() before build().');
    this.name = 'NoEntryNodeError';
  }
}
