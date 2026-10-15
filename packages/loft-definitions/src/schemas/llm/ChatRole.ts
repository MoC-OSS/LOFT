import { z } from 'zod';

export enum UnifiedMessageRole {
  system = 'system',
  user = 'user',
  assistant = 'assistant',
  function = 'function',
  tool = 'tool'
}

export const UnifiedMessageRoleEnumSchema = z.nativeEnum(UnifiedMessageRole);
