import { ChainResult } from '../ChainInterfaces';
import { BaseChainStrategy } from '../ChainInterfaces';

export abstract class AbstractChain<
  TContext,
  TPayload,
  TResult extends ChainResult<TPayload>
> implements BaseChainStrategy<TContext, TPayload, TResult> {
  protected _nextCalled: boolean;
  protected _ctx: TContext;

  constructor(ctx: TContext) {
    this._nextCalled = false;
    this._ctx = ctx;
  }

  get nextCalled(): boolean {
    return this._nextCalled;
  }

  get ctx(): TContext {
    return this._ctx;
  }

  updateCtx(update: Partial<TContext>): void {
    this._ctx = { ...this._ctx, ...update };
  }

  next(): void {
    this._nextCalled = true;
  }

  resetNext() {
    this._nextCalled = false;
  }

  abstract getResult(payload: TPayload): TResult;
}
