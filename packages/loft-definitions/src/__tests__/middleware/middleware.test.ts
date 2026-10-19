import { beforeEach, describe, expect, test } from 'vitest';

import { Middleware, MiddlewareManager, Type } from '../..';
import {
  BeforeGenerateChainResult,
  BeforeGenerateChainStrategy,
  ChainResult,
  StandardChainStrategy
} from '../../shared/components/middleware/chain/ChainInterfaces';
import { BeforeGenerateChain, StandardChain } from '../../shared/components/middleware/chain/strategies';

describe('MiddlewareManager', () => {
  // For standard tests
  let middlewareManager: MiddlewareManager<
    Record<string, any>,
    Record<string, any>,
    ChainResult<Record<string, any>>,
    StandardChainStrategy<Record<string, any>, Record<string, any>>
  >;

  // For tests with preventGeneration
  let beforeGenerateMiddlewareManager: MiddlewareManager<
    Record<string, any>,
    Record<string, any>,
    BeforeGenerateChainResult<Record<string, any>>,
    BeforeGenerateChainStrategy<Record<string, any>, Record<string, any>>
  >;

  beforeEach(() => {
    // Setup standard middleware manager
    middlewareManager = new MiddlewareManager<
      Record<string, any>,
      Record<string, any>,
      ChainResult<Record<string, any>>,
      StandardChainStrategy<Record<string, any>, Record<string, any>>
    >((ctx) => new StandardChain(ctx), 'standard');

    // Setup BeforeGenerate middleware manager
    beforeGenerateMiddlewareManager = new MiddlewareManager<
      Record<string, any>,
      Record<string, any>,
      BeforeGenerateChainResult<Record<string, any>>,
      BeforeGenerateChainStrategy<Record<string, any>, Record<string, any>>
    >((ctx) => new BeforeGenerateChain(ctx), 'beforeGenerate');
  });

  test('should return payload as exist when no middleware is added', async () => {
    const message = 'Hello, World!';
    const initialPayload = { message };
    const { payload: finalPayload } = await middlewareManager.executeChain({}, initialPayload, ['correlatorId']);
    expect(finalPayload).toBe(initialPayload);
    expect(finalPayload.message).toBe(message);
  });

  test("leaves the caller's payload unchanged when a middleware changes its input", async () => {
    middlewareManager.use('mutating', async (_ctx, payload, chain) => {
      payload.message = 'changed';
      payload.nested.items.push('added');
      chain.next();
      return payload;
    });
    const initialPayload = { message: 'original', nested: { items: ['first'] } };

    const { payload: finalPayload } = await middlewareManager.executeChain({}, initialPayload, ['correlatorId']);

    expect(initialPayload).toEqual({ message: 'original', nested: { items: ['first'] } });
    expect(finalPayload).toEqual({ message: 'changed', nested: { items: ['first', 'added'] } });
  });

  test('should add middleware successfully', () => {
    const middleware: Middleware<Record<string, any>, Record<string, any>> = async (ctx, payload, chain) => {
      chain.next();
      return payload;
    };
    expect(() => middlewareManager.use('testMiddleware', middleware)).not.toThrow();
  });

  test('should throw error when adding middleware with duplicate name', () => {
    const middleware: Middleware<Record<string, any>, Record<string, any>> = async (ctx, payload, chain) => {
      chain.next();
      return payload;
    };
    middlewareManager.use('testMiddleware', middleware);
    expect(() => middlewareManager.use('testMiddleware', middleware)).toThrow();
  });

  test('should stop chain execution when middleware throws error', async () => {
    middlewareManager.use('first', async () => {
      throw new Error('Middleware error');
    });
    middlewareManager.use(
      'second',
      async (
        _ctx: Record<string, any>,
        payload: Record<string, any>,
        chain: StandardChainStrategy<Record<string, any>, Record<string, any>>
      ) => {
        payload.second = true;
        chain.next();
        return payload;
      }
    );

    const initialPayload = {};
    try {
      await middlewareManager.executeChain({}, initialPayload, ['correlatorId']);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as any).message).toBe('Forced failure in middleware: first, correlatorId: correlatorId');
    }
  });

  test('should execute middleware in order and modify payload', async () => {
    middlewareManager.use(
      'first',
      async (
        _ctx: Record<string, any>,
        payload: Record<string, any>,
        chain: StandardChainStrategy<Record<string, any>, Record<string, any>>
      ) => {
        payload.first = true;
        chain.next();
        return payload;
      }
    );
    middlewareManager.use(
      'second',
      async (
        _ctx: Record<string, any>,
        payload: Record<string, any>,
        chain: StandardChainStrategy<Record<string, any>, Record<string, any>>
      ) => {
        payload.second = true;
        chain.next();
        return payload;
      }
    );

    const initialPayload = {};
    const { payload: finalPayload } = await middlewareManager.executeChain({}, initialPayload, ['correlatorId']);
    expect(finalPayload).toEqual({ first: true, second: true });
  });

  test('should stop chain execution when next is not called', async () => {
    middlewareManager.use('first', async (_ctx: Record<string, any>, payload: Record<string, any>) => {
      payload.first = true;
      return payload;
    });

    middlewareManager.use(
      'second',
      async (
        _ctx: Record<string, any>,
        payload: Record<string, any>,
        chain: StandardChainStrategy<Record<string, any>, Record<string, any>>
      ) => {
        payload.second = true;
        chain.next();
        return payload;
      }
    );

    const initialPayload = {};
    const { payload: finalPayload } = await middlewareManager.executeChain({}, initialPayload, ['correlatorId']);
    expect(finalPayload).toEqual({ first: true, second: undefined });
  });

  test('should propagate context updates', async () => {
    middlewareManager.use(
      'updateCtx',
      async (
        _ctx: Record<string, any>,
        payload: Record<string, any>,
        chain: StandardChainStrategy<Record<string, any>, Record<string, any>>
      ) => {
        chain.updateCtx({ updated: true });
        chain.next();
        return payload;
      }
    );
    middlewareManager.use(
      'checkCtx',
      async (
        _ctx: Record<string, any>,
        payload: Record<string, any>,
        chain: StandardChainStrategy<Record<string, any>, Record<string, any>>
      ) => {
        payload.ctxUpdated = chain.ctx.updated;
        chain.next();
        return payload;
      }
    );

    const initialPayload = {};
    const { payload: finalPayload } = await middlewareManager.executeChain({}, initialPayload, ['correlatorId']);
    expect(finalPayload.ctxUpdated).toBeTruthy();
  });

  test('should handle chain.preventGeneration correctly', async () => {
    const fakeMessage = {
      fakeMessage: {
        content: 'test',
        role: Type.LLM.UnifiedMessageRole.user
      }
    } as unknown as Type.Entity.CreateMessage;

    beforeGenerateMiddlewareManager.use(
      'preventGen',
      async (
        _ctx: Record<string, any>,
        payload: Record<string, any>,
        chain: BeforeGenerateChainStrategy<Record<string, any>, Record<string, any>>
      ) => {
        chain.preventGeneration(fakeMessage);
        chain.next();
        return payload;
      }
    );

    beforeGenerateMiddlewareManager.use(
      'second',
      async (
        _ctx: Record<string, any>,
        payload: Record<string, any>,
        chain: BeforeGenerateChainStrategy<Record<string, any>, Record<string, any>>
      ) => {
        payload.second = true;
        chain.next();
        return payload;
      }
    );

    const initialPayload = {};
    const {
      payload: finalPayload,
      isGenerationPrevented,
      overrideGenerateResponse
    } = await beforeGenerateMiddlewareManager.executeChain({}, initialPayload, ['correlatorId']);

    expect(finalPayload).toEqual({ second: true });
    expect(isGenerationPrevented).toBe(true);
    expect(overrideGenerateResponse).not.toBeNull();
  });

  test('should return preventGeneration values even when chain.next() is not called', async () => {
    const fakeMessage = {
      fakeMessage: {
        content: 'test',
        role: Type.LLM.UnifiedMessageRole.user
      }
    } as unknown as Type.Entity.CreateMessage;

    beforeGenerateMiddlewareManager.use(
      'preventGen',
      async (
        _ctx: Record<string, any>,
        payload: Record<string, any>,
        chain: BeforeGenerateChainStrategy<Record<string, any>, Record<string, any>>
      ) => {
        chain.preventGeneration(fakeMessage);
        // Deliberately not calling chain.next()
        return payload;
      }
    );

    beforeGenerateMiddlewareManager.use(
      'second',
      async (
        _ctx: Record<string, any>,
        payload: Record<string, any>,
        chain: BeforeGenerateChainStrategy<Record<string, any>, Record<string, any>>
      ) => {
        payload.second = true;
        chain.next();
        return payload;
      }
    );

    const initialPayload = {};
    const {
      payload: finalPayload,
      isGenerationPrevented,
      overrideGenerateResponse
    } = await beforeGenerateMiddlewareManager.executeChain({}, initialPayload, ['correlatorId']);

    expect(finalPayload).toEqual({}); // Second middleware was not executed
    expect(isGenerationPrevented).toBe(true);
    expect(overrideGenerateResponse).not.toBeNull();
  });
});
