import { z } from 'zod';

import { Schema, Strategy } from '..';

export type CallContext = z.infer<typeof Schema.LLM.CallContext>;
export type CallManagerResponse = z.infer<typeof Schema.LLM.CallManagerResponse>;
export type LoftLLM = Strategy.LLM.LoftLLM<any, any>;

// Export enum for both type and value usage
export { UnifiedMessageRole } from '../schemas/llm/ChatRole';
