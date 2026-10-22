import { describe, expect, it, vi } from 'vitest';
import { z, ZodSchema } from 'zod';

import { ContextInterface, Logger, Middleware, Strategy } from '../..';

class TestLoftLLM extends Strategy.LLM.AbstractLoftLLM<unknown, unknown> {
  readonly llmName = 'test';
  protected readonly log = new Logger('TestLoftLLM');

  async formatToLLMRequest(): Promise<unknown> {
    return {};
  }

  formatToUnifiedLLMResponse(): Strategy.LLM.UnifiedLLMResponse {
    throw new Error('not used');
  }

  generateModelPresetSchema(): ZodSchema<unknown> {
    return z.object({});
  }

  generateResponseSchema(): ZodSchema<unknown> {
    return z.object({});
  }
}

describe('AbstractLoftLLM', () => {
  it('forwards the call options to callManagerStrategy.call', async () => {
    const { signal } = new AbortController();
    const response = { llmBody: 'response' };
    const call = vi.fn().mockResolvedValue(response);
    const llm = new TestLoftLLM({ call } as unknown as Strategy.CallManager);
    const request: Strategy.LLM.LLMRequest<unknown> = {
      sessionId: 'session-1',
      requestType: Strategy.LLM.LLMRequestType.GENERATE,
      llmName: 'test',
      llmBody: {}
    };

    await expect(llm.generate(request, { signal })).resolves.toBe(response);

    expect(call).toHaveBeenCalledWith(request, { signal });
  });

  it('generate forwards onEvent', async () => {
    const onEvent = vi.fn();
    const call = vi.fn().mockResolvedValue({ llmBody: 'response' });
    const llm = new TestLoftLLM({ call } as unknown as Strategy.CallManager);
    const request: Strategy.LLM.LLMRequest<unknown> = {
      sessionId: 'session-1',
      requestType: Strategy.LLM.LLMRequestType.GENERATE,
      llmName: 'test',
      llmBody: {}
    };
    const options: Strategy.LLM.CallOptions = { onEvent };

    await llm.generate(request, options);

    expect(call).toHaveBeenCalledTimes(1);
    // The same options object arrives, so the sink is not wrapped or replaced
    expect(call.mock.calls[0][1]).toBe(options);
    expect(call.mock.calls[0][1].onEvent).toBe(onEvent);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('hasOutputMiddleware reflects useMiddleware', () => {
    const passThrough: Middleware<ContextInterface, Strategy.LLM.UnifiedLLMResponse> = async (_ctx, payload, chain) => {
      chain.next();
      return payload;
    };
    const llm = new TestLoftLLM();
    expect(llm.hasOutputMiddleware()).toBe(false);

    llm.useMiddleware('observer', passThrough, { transformsOutput: false });
    expect(llm.hasOutputMiddleware()).toBe(false);

    llm.useMiddleware('rewriter', passThrough);
    expect(llm.hasOutputMiddleware()).toBe(true);
  });

  it('stops the call manager on stop()', () => {
    const stop = vi.fn();
    const llm = new TestLoftLLM({ stop } as unknown as Strategy.CallManager);

    llm.stop();

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stop() works without a call manager or without its stop()', () => {
    expect(() => new TestLoftLLM().stop()).not.toThrow();
    expect(() => new TestLoftLLM({} as Strategy.CallManager).stop()).not.toThrow();
  });
});
