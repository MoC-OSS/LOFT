import { Interface, Logger, Strategy } from '@moc-global/loft-definitions';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { GenerateWithStreamManager } from '../../GenerateWithStreamManager';

const REQUEST: Strategy.LLM.LLMRequest<unknown> = {
  sessionId: 'session-1',
  requestType: Strategy.LLM.LLMRequestType.GENERATE,
  llmName: 'fake',
  llmBody: {},
  priority: 30
};

function managerWith(generateStream: () => Promise<unknown>) {
  const llmApi = {
    generateStream,
    reduceMessages: () => 'hello',
    tokenRateLimiter: { awaitBeforeCall: vi.fn().mockResolvedValue(undefined), setUsedRequest: vi.fn() },
    llmTokenizer: { calculateTokensFromString: () => 1 }
  } as unknown as Strategy.LLM.LLMApi;
  return new GenerateWithStreamManager(
    'test',
    { highPriorityTasksLimit: 10, retryDelay: 0, retryAttemptsLimit: 3 },
    llmApi
  );
}

describe('GenerateWithStreamManager retries', () => {
  beforeAll(() => {
    Logger.configure({ logLevel: Interface.LogLevel.NONE });
  });

  it('retries a 503 response', async () => {
    const generateStream = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('unavailable'), { status: 503 }))
      .mockResolvedValue([]);

    await expect(managerWith(generateStream).addHighPriorityTask(REQUEST)).resolves.toBeDefined();
    expect(generateStream).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 404])('does not retry a %i response', async (status) => {
    const generateStream = vi.fn().mockRejectedValue(Object.assign(new Error('rejected'), { status }));

    await expect(managerWith(generateStream).addHighPriorityTask(REQUEST)).rejects.toThrow('rejected');
    expect(generateStream).toHaveBeenCalledTimes(1);
  });
});
