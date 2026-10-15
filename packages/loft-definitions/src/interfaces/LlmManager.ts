import { Chat, ContextInterface, Middleware, Strategy, Type } from '..';

export interface StrategyArgsFacade {
  llmName: string;
  middlewares?: Array<{
    name: string;
    middleware: Middleware<ContextInterface, Strategy.LLM.LlmResponse<any>>;
  }>;
  loftQueue?: Strategy.LoftQueue;
}

export interface LlmManager {
  use(llmName: string, llmStrategy: Type.LLM.LoftLLM, forceOverwrite: boolean): Promise<void>;
  get(name?: string): Type.LLM.LoftLLM;
  generate(
    ctx: ContextInterface,
    llmName: string,
    manifestName: string,
    messages: Type.Entity.CreateMessage[],
    additionalTools?: Chat.AdditionalTool[],
    priority?: number,
    callOptions?: Strategy.LLM.CallOptions
  ): Promise<Strategy.LLM.UnifiedLLMResponse>;
  aiTask(
    ctx: ContextInterface,
    llmName: string,
    manifestName: string,
    content: string | Type.Entity.Message[],
    priority?: number
  ): Promise<Strategy.LLM.UnifiedLLMResponse>;
  generateQueued(
    ctx: ContextInterface,
    manifestName: string,
    callContext: Type.LLM.CallContext,
    tempLlmName?: string,
    priority?: number
  ): Promise<void>;
  generateStream(
    ctx: ContextInterface,
    manifestName: string,
    tempLlmName?: string,
    priority?: number
  ): Promise<Strategy.LLM.UnifiedLLMStream>;
  getPrompt(ctx: ContextInterface, promptName: string, llmName: string): Promise<string>;
  getHealthCheckStatuses(): Promise<boolean[]>;
  /** Stops the background timers of every registered LLM strategy. */
  stop?(): void;
}
