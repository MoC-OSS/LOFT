import { Message } from './Message';
import { Session } from './Session';
import { State } from './State';

/** @experimental Part of the Queued execution mode, which is not implemented yet. May change or be removed in any release. */
export interface SMG {
  session: Session;
  message: Message;
  state: State;
  checkEnums(): void;
  checkHealth(): Promise<boolean>;
}
