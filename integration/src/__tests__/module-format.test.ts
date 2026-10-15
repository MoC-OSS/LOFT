import { createRequire } from 'node:module';
import path from 'node:path';

import { LoftConstructor } from '@moc-global/loft';
import { describe, expect, it } from 'vitest';

// Each run names the build it tests (vitest.shared.mts). Only the CommonJS run may load packages through require, so
// a config that resolved the ES modules, or the sources, by mistake fails here.
describe('package build under test', () => {
  const build = process.env.LOFT_TEST_PACKAGE_BUILD;
  const commonJsEntry = path.resolve(__dirname, '../../../packages/loft/lib/index.js');

  it('loads @moc-global/loft from the build the config names', () => {
    expect(['src', 'esm', 'cjs']).toContain(build);
    expect(LoftConstructor).toBeTypeOf('function');

    const loadedThroughRequire = commonJsEntry in createRequire(__filename).cache;
    expect(loadedThroughRequire).toBe(build === 'cjs');
  });
});
