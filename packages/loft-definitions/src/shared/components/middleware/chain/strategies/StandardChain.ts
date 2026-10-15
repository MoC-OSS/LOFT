import { StandardChainStrategy } from '../ChainInterfaces';
import { ChainResult } from '../ChainInterfaces';
import { AbstractChain } from './AbstractChain';

export class StandardChain<TContext, TPayload>
  extends AbstractChain<TContext, TPayload, ChainResult<TPayload>>
  implements StandardChainStrategy<TContext, TPayload>
{
  getResult(payload: TPayload): ChainResult<TPayload> {
    return { payload };
  }
}
