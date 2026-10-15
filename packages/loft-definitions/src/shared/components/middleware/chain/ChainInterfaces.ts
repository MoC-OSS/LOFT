import { Strategy, Type } from '../../../..';

export type OverrideGeneratePayload = {
  content: Type.Entity.FullContentPart[];
  role: Type.LLM.UnifiedMessageRole;
  llmName?: string;
  manifestName?: string;
};

// Base types for chain results
export type ChainResult<TPayload> = {
  payload: TPayload;
};

export type BeforeGenerateChainResult<TPayload> = ChainResult<TPayload> &
  (
    | {
        isGenerationPrevented: true;
        overrideGenerateResponse: Strategy.LLM.UnifiedLLMResponse;
      }
    | {
        isGenerationPrevented: false;
        overrideGenerateResponse: null;
      }
  );

// Chain strategy interfaces
export interface BaseChainStrategy<TContext, TPayload, TResult extends ChainResult<TPayload>> {
  nextCalled: boolean;
  ctx: TContext;
  updateCtx(update: Partial<TContext>): void;
  next(): void;
  getResult(payload: TPayload): TResult;
}

export interface BeforeGenerateChainStrategy<TContext, TPayload> extends BaseChainStrategy<
  TContext,
  TPayload,
  BeforeGenerateChainResult<TPayload>
> {
  preventGeneration(overrideGeneratePayload: OverrideGeneratePayload): void;
  isGenerationPrevented: boolean;
  overrideGenerateResponse: OverrideGeneratePayload | null;
}

export interface StandardChainStrategy<TContext, TPayload> extends BaseChainStrategy<
  TContext,
  TPayload,
  ChainResult<TPayload>
> {
  // Additional standard chain methods if needed
}
