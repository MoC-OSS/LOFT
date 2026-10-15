import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LangfuseModule, LangfuseTracer } from '../../../base-components/LangfuseTracer';

// LangfuseTracer loads langfuse through createRequire; this replaces what that require returns
const loader = vi.hoisted(() => ({
  from: vi.fn<(path: string) => void>(),
  require: vi.fn<(id: string) => unknown>()
}));

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return {
    ...actual,
    createRequire: (path: string) => {
      loader.from(path);
      return (id: string) => loader.require(id);
    }
  };
});

class FakeLangfuse {
  static configs: unknown[] = [];
  trace = vi.fn().mockReturnValue({ span: vi.fn(), generation: vi.fn(), event: vi.fn(), score: vi.fn() });
  shutdownAsync = vi.fn().mockResolvedValue(undefined);
  constructor(config: unknown) {
    FakeLangfuse.configs.push(config);
  }
}

const fakeModule = { Langfuse: FakeLangfuse } as unknown as LangfuseModule;
const config = { secretKey: 'sk', publicKey: 'pk' };

const notFound = (id: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`Cannot find module '${id}'\nRequire stack:\n- /app/index.js`), {
    code: 'MODULE_NOT_FOUND'
  });

describe('LangfuseTracer', () => {
  beforeEach(() => {
    FakeLangfuse.configs = [];
    loader.from.mockReset();
    loader.require.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the langfuse module it is given and does not load one', () => {
    const tracer = new LangfuseTracer(config, fakeModule);

    tracer.createTracer({ traceId: 'trace-1', name: 'test' });

    expect(FakeLangfuse.configs).toEqual([config]);
    expect(loader.require).not.toHaveBeenCalled();
  });

  it('loads langfuse itself when no module is given', () => {
    loader.require.mockReturnValue(fakeModule);

    new LangfuseTracer(config);

    expect(loader.require).toHaveBeenCalledWith('langfuse');
    expect(loader.from).toHaveBeenCalledWith(expect.stringMatching(/^\//));
    expect(FakeLangfuse.configs).toEqual([config]);
  });

  it('loads langfuse from the module URL in the ES module build', () => {
    // tsup defines __LOFT_ESM_BUILD__ per build; a global stands in for it here
    vi.stubGlobal('__LOFT_ESM_BUILD__', true);
    loader.require.mockReturnValue(fakeModule);

    new LangfuseTracer(config);

    expect(loader.from).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\//));
    expect(loader.require).toHaveBeenCalledWith('langfuse');
  });

  it('says how to install langfuse when it is missing', () => {
    loader.require.mockImplementation(() => {
      throw notFound('langfuse');
    });

    expect(() => new LangfuseTracer(config)).toThrow('npm install langfuse@^3');
  });

  it('keeps the original error when a module that langfuse needs is missing', () => {
    loader.require.mockImplementation(() => {
      throw notFound('langfuse-core');
    });

    expect(() => new LangfuseTracer(config)).toThrow("Cannot find module 'langfuse-core'");
  });
});
