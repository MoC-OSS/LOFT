import { describe, expectTypeOf, it } from 'vitest';

import type { AdditionalTool, AdditionalToolContext, AdditionalToolResult } from '../shared/components/Chat';
import { AdditionalToolSchemaType } from '../shared/components/Chat';

const result: AdditionalToolResult = { content: [] };

const definition: AdditionalTool['definition'] = {
  name: 'lookup_order',
  description: 'Looks up an order',
  inputSchema: { type: AdditionalToolSchemaType.OBJECT }
};

describe('AdditionalTool handler context', () => {
  it('one-argument handler is assignable', () => {
    const tool: AdditionalTool = {
      definition,
      handler: async (_args: Record<string, unknown>) => result
    };

    expectTypeOf(tool.handler).toBeFunction();
  });

  it('handler declaring a required context is assignable', () => {
    // Method syntax makes the parameter bivariant, so a handler may declare the context as required
    const tool: AdditionalTool = {
      definition,
      handler: async (_args: Record<string, unknown>, _context: AdditionalToolContext) => result
    };

    expectTypeOf(tool.handler).toBeFunction();
  });

  it('tool.handler({}) compiles', () => {
    const tool: AdditionalTool = { definition, handler: async () => result };

    expectTypeOf(tool.handler({})).resolves.toEqualTypeOf<AdditionalToolResult>();
    expectTypeOf(tool.handler({}, { emit: () => undefined })).resolves.toEqualTypeOf<AdditionalToolResult>();
    // @ts-expect-error the arguments are required
    void tool.handler();
  });

  it('context has an optional signal and a required emit', () => {
    expectTypeOf<AdditionalToolContext['signal']>().toEqualTypeOf<AbortSignal | undefined>();
    expectTypeOf<AdditionalToolContext['emit']>().toEqualTypeOf<(name: string, data: unknown) => void>();

    // @ts-expect-error emit is required
    const withoutEmit: AdditionalToolContext = { signal: new AbortController().signal };
    void withoutEmit;
  });

  it('handler argument types stay checked', () => {
    const wrongArgs: AdditionalTool = {
      definition,
      // @ts-expect-error the first parameter is a record of unknown values
      handler: async (_args: string) => result
    };
    void wrongArgs;
  });
});
