import { Transform } from 'stream';

import { Strategy } from '../..';

/**
 * @deprecated Use chat.generate({ onEvent }) instead.
 * Removed in the next major release.
 */
export abstract class UnifiedLLMStream extends Transform {
  constructor() {
    super({ objectMode: true });
  }

  async *[Symbol.asyncIterator]() {
    for await (const chunk of super[Symbol.asyncIterator]()) {
      yield chunk as Strategy.LLM.UnifiedLLMChunkResponse;
    }
  }

  _transform(chunk: Buffer, encoding: any, callback: any) {
    const formattedData = this.formatResponse(chunk);
    this.push(formattedData);
    callback();
  }
  protected abstract formatResponse(originalResponse: Buffer): Strategy.LLM.UnifiedLLMChunkResponse;
}
