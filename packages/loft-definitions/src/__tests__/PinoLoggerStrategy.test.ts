import { AxiosError, AxiosHeaders } from 'axios';
import { Writable } from 'stream';
import { describe, expect, it } from 'vitest';

import { PinoLoggerStrategy } from '../shared/components/PinoLoggerStrategy';

// Collects the JSON lines the strategy writes
function capture(): { strategy: PinoLoggerStrategy; lines: () => Record<string, any>[] } {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    }
  });
  return {
    strategy: new PinoLoggerStrategy(destination),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
  };
}

function axiosError(): AxiosError {
  const config = {
    headers: new AxiosHeaders({ Authorization: 'Bearer sk-secret', 'x-api-key': 'sk-secret' }),
    data: JSON.stringify({ messages: [{ role: 'user', content: 'my card is 4111 1111 1111 1111' }] })
  };
  return new AxiosError(
    'Request failed with status code 500',
    'ERR_BAD_RESPONSE',
    config,
    {},
    {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {},
      config,
      data: { error: 'boom' }
    }
  );
}

describe('PinoLoggerStrategy', () => {
  it('drops the request of an HTTP error but keeps its message and status', () => {
    const { strategy, lines } = capture();

    strategy.error('call failed', 'Test', axiosError());

    const output = JSON.stringify(lines());
    expect(output).not.toContain('sk-secret');
    expect(output).not.toContain('4111');
    expect(lines()[0].error).toMatchObject({
      message: 'Request failed with status code 500',
      code: 'ERR_BAD_RESPONSE',
      status: 500
    });
  });

  it('drops the request of an HTTP error passed as an extra argument', () => {
    const { strategy, lines } = capture();

    strategy.warn('refresh failed', 'Test', axiosError());

    const output = JSON.stringify(lines());
    expect(output).not.toContain('sk-secret');
    expect(output).not.toContain('4111');
    expect(lines()[0].extra[0]).toMatchObject({ message: 'Request failed with status code 500', status: 500 });
  });

  it('drops the request of an HTTP error that is the cause of another error', () => {
    const { strategy, lines } = capture();

    strategy.error('generate failed', 'Test', new Error('LLM call failed', { cause: axiosError() }));

    expect(JSON.stringify(lines())).not.toContain('sk-secret');
    expect(lines()[0].error.cause).toMatchObject({ status: 500 });
  });

  it('redacts credentials in logged objects', () => {
    const { strategy, lines } = capture();

    strategy.info('configured', 'Test', {
      apiKey: 'sk-secret',
      headers: { authorization: 'Bearer sk-secret', 'x-api-key': 'sk-secret', accept: 'application/json' },
      model: 'gpt-4o'
    });

    const [line] = lines();
    expect(JSON.stringify(line)).not.toContain('sk-secret');
    expect(line.extra[0]).toEqual({
      apiKey: '[Redacted]',
      headers: { authorization: '[Redacted]', 'x-api-key': '[Redacted]', accept: 'application/json' },
      model: 'gpt-4o'
    });
  });

  it('redacts credential headers in their capitalised spelling too', () => {
    const { strategy, lines } = capture();

    strategy.warn('request', 'Test', {
      headers: { Authorization: 'Bearer sk-secret', 'X-Api-Key': 'sk-secret', Cookie: 'sid=sk-secret' }
    });

    expect(lines()[0].extra[0].headers).toEqual({
      Authorization: '[Redacted]',
      'X-Api-Key': '[Redacted]',
      Cookie: '[Redacted]'
    });
  });

  it('still logs a plain error with its message and stack', () => {
    const { strategy, lines } = capture();

    strategy.error('failed', 'Test', new Error('boom'));

    expect(lines()[0]).toMatchObject({ msg: 'failed', target: 'Test', error: { message: 'boom' } });
    expect(lines()[0].error.stack).toContain('boom');
  });
});
