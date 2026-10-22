import copy from 'fast-copy';

import { Logger, Strategy } from '../../..';
import { BaseChainStrategy, ChainResult } from './chain/ChainInterfaces';
import { createContextProxyWithOverrides } from './contextProxy';
import { BaseMiddleware } from './Middleware';

export class MiddlewareManager<
  TContext extends Record<string, any>,
  TPayload,
  TResult extends ChainResult<TPayload>,
  TChainStrategy extends BaseChainStrategy<TContext, TPayload, TResult>
> {
  private middlewareChain: Map<string, BaseMiddleware<TContext, TPayload, TResult, TChainStrategy>> = new Map();
  // Names of the middleware that may change the payload; the others only observe it
  private transformingMiddleware: Set<string> = new Set();
  private readonly log: Logger;
  private createChain: (ctx: TContext) => TChainStrategy;
  private middlewareType: string;

  constructor(chainFactory: (ctx: TContext) => TChainStrategy, middlewareType: string) {
    this.createChain = chainFactory;
    this.middlewareType = middlewareType;
    this.log = new Logger(`MiddlewareManager:${middlewareType}`);
  }

  use(
    name: string,
    middleware: BaseMiddleware<TContext, TPayload, TResult, TChainStrategy>,
    /** @experimental `transformsOutput: false` declares that the middleware does not change the payload. Default true. */
    options?: { transformsOutput?: boolean }
  ) {
    if (this.middlewareChain.has(name)) {
      throw new Error(`A middleware with the name "${name}" already exists.`);
    }
    this.middlewareChain.set(name, middleware);
    if (options?.transformsOutput ?? true) this.transformingMiddleware.add(name);
    return;
  }

  /** @experimental The number of registered middleware that may change the payload. */
  get transformingCount(): number {
    return this.transformingMiddleware.size;
  }

  /** @experimental The names of the registered middleware that may change the payload, in registration order. */
  get transformingNames(): string[] {
    return [...this.middlewareChain.keys()].filter((name) => this.transformingMiddleware.has(name));
  }

  async executeChain(context: TContext, payload: TPayload, correlatorIds: string[]): Promise<TResult> {
    const correlatorIdsString = correlatorIds.join(', ');

    if (!this.log) {
      throw new Error(
        `setLogger() must be called before executing middleware chain, correlatorId: ${correlatorIdsString}`
      );
    }

    if (this.middlewareChain.size === 0) {
      const chain = this.createChain(context);
      return chain.getResult(payload);
    }

    const chain = this.createChain(context);
    const tracer = (context as any).tracer as Strategy.Tracer.Tracer | undefined;
    // The first middleware gets a copy too, so a middleware that changes its input leaves the caller's payload alone
    payload = copy(payload);

    for (const [name, middleware] of this.middlewareChain) {
      let middlewareSpan: Strategy.Tracer.Span | undefined;
      let contextForMiddleware = context;

      try {
        if (tracer) {
          // Create span for this middleware with type
          middlewareSpan = tracer.span({
            name: `middleware/${this.middlewareType}/${name}`,
            input: { payload },
            metadata: {
              middlewareName: name,
              middlewareType: this.middlewareType,
              correlatorIds
            }
          });

          // Create wrapped tracer with this span as parent
          const wrappedTracer = tracer.withParent(middlewareSpan.id);

          // Create proxy context with overridden tracer
          contextForMiddleware = createContextProxyWithOverrides(context, {
            tracer: wrappedTracer
          } as any);

          this.log.trace(`Middleware span created`, {
            name,
            spanId: middlewareSpan.id,
            correlatorIds
          });
        }

        // resetNext() is system method for chain, it must be implemented in chain, but we don't add it to the chain interface
        (chain as unknown as { resetNext(): void }).resetNext();

        // Execute middleware with proxied context
        payload = copy(await middleware(contextForMiddleware, payload, chain));

        // End span with success
        middlewareSpan?.end({
          output: payload,
          level: 'DEFAULT'
        });

        if (!chain.nextCalled) {
          this.log.trace(`Middleware chain stopped after middleware name: ${name}.`, { correlatorIds });
          break;
        }
      } catch (error) {
        // End span with error
        middlewareSpan?.end({
          level: 'ERROR',
          statusMessage: error instanceof Error ? error.message : String(error)
        });

        this.log.error(`Stopping middleware chain due to an error in middleware name ${name}`, error, {
          correlatorIds
        });
        throw new Error(`Forced failure in middleware: ${name}, correlatorId: ${correlatorIdsString}`, {
          cause: error
        });
      }
    }

    return chain.getResult(payload);
  }
}
