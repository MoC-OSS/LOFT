import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Which form of the LOFT packages the integration tests load:
 * - `src`: the TypeScript sources, for quick runs while developing
 * - `esm`: the built ES modules (lib/index.mjs), as `import` loads them
 * - `cjs`: the built CommonJS modules (lib/index.js), as `require` loads them
 */
export type PackageBuild = 'src' | 'esm' | 'cjs';

// npm name -> directory under packages/
const PACKAGES: Record<string, string> = {
  '@moc-global/loft': 'loft',
  '@moc-global/loft-agents': 'loft-agents',
  '@moc-global/loft-anthropic-strategy': 'loft-anthropic-strategy',
  '@moc-global/loft-chat-history-pg-repository': 'loft-chat-history-pg-repository',
  '@moc-global/loft-definitions': 'loft-definitions',
  '@moc-global/loft-gemini-strategy': 'loft-gemini-strategy',
  '@moc-global/loft-llm-call-manager': 'loft-llm-call-manager',
  '@moc-global/loft-openai-strategy': 'loft-openai-strategy',
  '@moc-global/loft-session-pg-repository': 'loft-session-pg-repository'
};

const ENTRY: Record<PackageBuild, string> = { src: 'src/index.ts', esm: 'lib/index.mjs', cjs: 'lib/index.js' };

export function integrationConfig(build: PackageBuild) {
  const packagesDir = path.resolve(__dirname, '../packages');
  const alias = Object.fromEntries(
    Object.entries(PACKAGES).map(([name, dir]) => [name, path.join(packagesDir, dir, ENTRY[build])])
  );

  return defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'node',
      // Read by the module-format test to check that the run loads the build it claims to
      env: { LOFT_TEST_PACKAGE_BUILD: build },
      pool: 'forks',
      poolOptions: {
        forks: {
          // The Postgres migrations are TypeScript files loaded at run time with import(), so a src run needs tsx's
          // CommonJS and ES module hooks
          execArgv: build === 'src' ? ['--import', 'tsx'] : []
        }
      },
      // Node loads the CommonJS build itself, through require, as an application would; Vite would otherwise
      // transform those files as ES modules
      server: build === 'cjs' ? { deps: { external: [/[\\/]packages[\\/][^\\/]+[\\/]lib[\\/]/] } } : undefined,
      testTimeout: 60000,
      hookTimeout: 30000
    },
    resolve: { alias }
  });
}
