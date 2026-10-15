import { Type } from '../..';

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function ejectMessageIdsFromMessages(messages: Type.SMG.Message[] | Type.Entity.CreateMessage[]): string[] {
  return messages.map((message) => message.id ?? '').filter((id) => id !== '');
}
export function ejectCorrelatorIdsFromMessages(messages: Type.SMG.Message[]): string[] {
  return messages.map((message) => message.correlatorId);
}
