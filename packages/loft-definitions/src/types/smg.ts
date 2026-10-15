import { z } from 'zod';

import { Schema, Type } from '..';

export type Session = z.infer<typeof Schema.SMG.Session>;
export type Message = z.infer<typeof Schema.SMG.Message>;
export type CreateMessage = z.infer<typeof Schema.SMG.CreateMessage>;
export type MessageWithStates = z.infer<typeof Schema.SMG.MessageWithStates>;
export type State = z.infer<typeof Schema.SMG.State>;
export type CreateState = Type.Insertable<State>;
export { MessageAction } from '../schemas/statefulMessageGateway/Message';
export { MessageStatus } from '../schemas/statefulMessageGateway/State';
export type SessionState = z.infer<typeof Schema.SMG.SessionState>;
export type SessionLockStatus = z.infer<typeof Schema.SMG.SessionLockStatus>;
