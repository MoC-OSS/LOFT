import { Interface, Logger, Strategy } from '@moc-global/loft-definitions';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GenerateWithStreamManager } from '../../GenerateWithStreamManager';

type Body = { messages: string[] };

const BODY: Body = { messages: ['hello'] };
const CONFIG = { highPriorityTasksLimit: 10, retryDelay: 0, retryAttemptsLimit: 3 };

async function* chunks(...texts: string[]) {
  for (const text of texts) yield Buffer.from(text);
}

// Yields the given chunks, then fails
async function* failAfter(...texts: string[]) {
  yield* texts.map((text) => Buffer.from(text));
  throw new Error('stream broke');
}

// A 503: an error the call managers retry
const unavailable = (message: string) => Object.assign(new Error(message), { status: 503 });

async function readAll(stream: AsyncGenerator<Buffer>) {
  const received: string[] = [];
  for await (const chunk of stream) received.push(chunk.toString());
  return received;
}

describe('GenerateWithStreamManager', () => {
  const generateStream = vi.fn();
  const awaitBeforeCall = vi.fn();
  const setUsedTokens = vi.fn();
  const setUsedRequest = vi.fn();
  let manager: GenerateWithStreamManager<Body, AsyncGenerator<Buffer>>;

  beforeAll(() => {
    Logger.configure({ logLevel: Interface.LogLevel.NONE });
  });

  beforeEach(() => {
    for (const mock of [generateStream, awaitBeforeCall, setUsedTokens, setUsedRequest]) mock.mockReset();
    const llmApi = {
      generateStream,
      reduceMessages: () => 'hello',
      extractContentFromChunk: (chunk: Buffer) => chunk.toString(),
      tokenRateLimiter: { awaitBeforeCall, setUsedTokens, setUsedRequest },
      // One token per character keeps the counts readable
      llmTokenizer: { calculateTokensFromString: (text: string) => text.length }
    } as unknown as Strategy.LLM.LLMApi;
    manager = new GenerateWithStreamManager('test', CONFIG, llmApi);
  });

  it('waits for the rate limiter with the predicted tokens, then passes every chunk through', async () => {
    generateStream.mockResolvedValue(chunks('Hel', 'lo!'));

    const stream = await manager.taskPQueueHandler(BODY);

    expect(awaitBeforeCall).toHaveBeenCalledWith(5);
    await expect(readAll(stream)).resolves.toEqual(['Hel', 'lo!']);
    expect(setUsedRequest).toHaveBeenCalledTimes(1);
    // The predicted request tokens and the six streamed characters
    expect(setUsedTokens).toHaveBeenCalledWith(11);
  });

  it('retries a request that fails to start', async () => {
    generateStream.mockRejectedValueOnce(unavailable('busy')).mockResolvedValue(chunks('ok'));

    const stream = await manager.taskPQueueHandler(BODY);

    await expect(readAll(stream)).resolves.toEqual(['ok']);
    expect(generateStream).toHaveBeenCalledTimes(2);
  });

  it('rejects with the last error after retryAttemptsLimit attempts', async () => {
    generateStream.mockRejectedValueOnce(unavailable('fail 1')).mockRejectedValueOnce(unavailable('fail 2'));
    generateStream.mockRejectedValue(unavailable('fail 3'));

    await expect(manager.taskPQueueHandler(BODY)).rejects.toThrow('fail 3');
    expect(generateStream).toHaveBeenCalledTimes(3);
  });

  it('counts the tokens streamed before the stream broke', async () => {
    generateStream.mockResolvedValue(failAfter('par'));

    const stream = await manager.taskPQueueHandler(BODY);

    await expect(readAll(stream)).rejects.toThrow('stream broke');
    expect(setUsedTokens).toHaveBeenCalledWith(8);
  });

  it('counts nothing when the stream broke before its first chunk', async () => {
    generateStream.mockResolvedValue(failAfter());

    const stream = await manager.taskPQueueHandler(BODY);

    await expect(readAll(stream)).rejects.toThrow('stream broke');
    expect(setUsedTokens).not.toHaveBeenCalled();
  });
});
