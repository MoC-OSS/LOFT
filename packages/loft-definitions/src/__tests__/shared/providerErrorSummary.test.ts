import { describe, expect, it } from 'vitest';

import { providerErrorSummary } from '../..';

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

describe('providerErrorSummary', () => {
  it('summarises an error by its class, status, type and code, never its message', () => {
    const error = Object.assign(new ApiError('Partial secret', 503), {
      name: 'Renamed',
      type: 'server_error',
      code: 'UNAVAILABLE'
    });

    const summary = providerErrorSummary(error);

    expect(summary).toEqual({ name: 'ApiError', status: 503, type: 'server_error', code: 'UNAVAILABLE' });
    expect(JSON.stringify(summary)).not.toMatch(/Partial secret/);
  });

  it('summarises values that are not objects by their type, and nameless errors by their class', () => {
    expect(providerErrorSummary('boom')).toEqual({ name: 'string' });
    expect(providerErrorSummary(undefined)).toEqual({ name: 'undefined' });
    expect(providerErrorSummary(null)).toEqual({ name: 'object' });
    expect(providerErrorSummary(Object.create({ constructor: { name: 'Custom' } }) as object)).toEqual({
      name: 'Custom',
      status: undefined,
      type: undefined,
      code: undefined
    });
  });
});
