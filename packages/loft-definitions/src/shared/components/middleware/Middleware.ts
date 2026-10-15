import {
  BaseChainStrategy,
  BeforeGenerateChainResult,
  ChainResult,
  StandardChainStrategy
} from './chain/ChainInterfaces';
import { BeforeGenerateChainStrategy } from './chain/ChainInterfaces';

// Base type for all middleware
export type BaseMiddleware<
  TContext,
  TPayload,
  TResult extends ChainResult<TPayload> = ChainResult<TPayload>,
  TStrategy extends BaseChainStrategy<TContext, TPayload, TResult> = BaseChainStrategy<TContext, TPayload, TResult>
> = (context: TContext, payload: TPayload, chain: TStrategy) => Promise<TPayload>;

// Standard middleware
export type StandardMiddleware<TContext, TPayload> = BaseMiddleware<
  TContext,
  TPayload,
  ChainResult<TPayload>,
  StandardChainStrategy<TContext, TPayload>
>;

// Middleware for InitialChain
export type BeforeGenerateMiddleware<TContext, TPayload> = BaseMiddleware<
  TContext,
  TPayload,
  BeforeGenerateChainResult<TPayload>,
  BeforeGenerateChainStrategy<TContext, TPayload>
>;

// general type for using in MiddlewareManager
export type Middleware<TContext, TPayload> = BaseMiddleware<TContext, TPayload>;
