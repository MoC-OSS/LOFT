import { ChainResult, StandardChainStrategy } from './chain/ChainInterfaces';
import { BeforeGenerateChainStrategy } from './chain/ChainInterfaces';
import { BeforeGenerateChainResult } from './chain/ChainInterfaces';
import { StandardChain } from './chain/strategies';
import { BeforeGenerateChain } from './chain/strategies';
import { MiddlewareManager } from './MiddlewareManager';

export type BeforeGenerateMiddlewareManager<TContext extends Record<string, any>, TPayload> = MiddlewareManager<
  TContext,
  TPayload,
  BeforeGenerateChainResult<TPayload>,
  BeforeGenerateChainStrategy<TContext, TPayload>
>;

// Factory functions with specific middleware types
export function createBeforeGenerateMiddlewareManager<TContext extends Record<string, any>, TPayload>(
  middlewareType: string
): BeforeGenerateMiddlewareManager<TContext, TPayload> {
  return new MiddlewareManager<
    TContext,
    TPayload,
    BeforeGenerateChainResult<TPayload>,
    BeforeGenerateChainStrategy<TContext, TPayload>
  >((ctx) => new BeforeGenerateChain(ctx), middlewareType);
}

export type StandardMiddlewareManager<TContext extends Record<string, any>, TPayload> = MiddlewareManager<
  TContext,
  TPayload,
  ChainResult<TPayload>,
  StandardChainStrategy<TContext, TPayload>
>;

export function createStandardMiddlewareManager<TContext extends Record<string, any>, TPayload>(
  middlewareType: string
): StandardMiddlewareManager<TContext, TPayload> {
  return new MiddlewareManager<TContext, TPayload, ChainResult<TPayload>, StandardChainStrategy<TContext, TPayload>>(
    (ctx) => new StandardChain(ctx),
    middlewareType
  );
}
