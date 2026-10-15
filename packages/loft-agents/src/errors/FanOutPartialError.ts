import { Agent } from '@moc-global/loft-definitions';

import { AgentError } from './AgentError';

export interface FanOutRejection {
  nodeName: string;
  error: Error;
}

export class FanOutPartialError extends AgentError {
  constructor(
    public readonly fulfilled: Agent.NodeResult[],
    public readonly rejected: FanOutRejection[]
  ) {
    const failedNames = rejected.map((r) => r.nodeName).join(', ');
    super(`FanOut partial failure: nodes [${failedNames}] rejected`);
    this.name = 'FanOutPartialError';
  }
}
