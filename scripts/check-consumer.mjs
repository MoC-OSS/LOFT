/* eslint-env node */
// Installs the packed packages into a fresh project, as a consumer would, with npm, pnpm or yarn
// (`node scripts/check-consumer.mjs <npm|pnpm|yarn>`), then checks that the project compiles as CommonJS and as an
// ES module, including a custom constructor written against its own inversify, that every package loads through import and require without the optional
// langfuse peer, and that all packages share one copy of each peer dependency. Run after the build.
// Needs the npm registry for the third-party dependencies.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const YARN_VERSION = '4.18.1';
const manager = process.argv[2];
if (!['npm', 'pnpm', 'yarn'].includes(manager)) {
  console.error('Usage: node scripts/check-consumer.mjs <npm|pnpm|yarn>');
  process.exit(2);
}

const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'commonjs',
    moduleResolution: 'node10',
    strict: true,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true
  },
  files: ['consumer.ts']
};

// consumer.mts is an ES module under nodenext, so it compiles against the packages' import types (index.d.mts)
const TSCONFIG_NODENEXT = {
  extends: './tsconfig.json',
  compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' },
  files: ['consumer.ts', 'consumer.mts']
};

const CONSUMER_TS = `import 'reflect-metadata';

import { ChatConstructor, FsRepositoryConstructor, LoftConstructor, ManifestManagerConstructor } from '@moc-global/loft';
import { OrchestratorBuilder } from '@moc-global/loft-agents';
import { AnthropicLoftStrategy } from '@moc-global/loft-anthropic-strategy';
import { AwsS3RepositoryConstructor } from '@moc-global/loft-aws-s3-repository';
import { AzureBlobStorageRepository } from '@moc-global/loft-azure-blob-storage-repository';
import { ChatHistoryPostgresDialect, ChatHistoryRepositoryConstructor } from '@moc-global/loft-chat-history-pg-repository';
import { Interface, Repository } from '@moc-global/loft-definitions';
import { GcpStorageRepository } from '@moc-global/loft-gcp-storage-repository';
import { GeminiLoftStrategy } from '@moc-global/loft-gemini-strategy';
import { GenerateCallManager, LlmTokenizer, LlmTokenRateLimiter } from '@moc-global/loft-llm-call-manager';
import { OpenAiCallStrategy, OpenAiLoftStrategy } from '@moc-global/loft-openai-strategy';
import { SQSStrategy } from '@moc-global/loft-queue-sqs-strategy';
import { SessionPostgresDialect, SessionRepositoryConstructor } from '@moc-global/loft-session-pg-repository';
import { SQSClient } from '@aws-sdk/client-sqs';
import { Container } from 'inversify';
import { z } from 'zod';

// A constructor written against the consumer's own inversify satisfies the LOFT types
export class InMemorySessionRepositoryConstructor implements Interface.BaseComponentConstructor<Repository.Session> {
  private container = new Container();

  initializeContainer(mainContainer: Container): void {
    this.container.parent = mainContainer;
  }

  getInstance(): Repository.Session {
    throw new Error('not used');
  }
}

// The consumer's zod and AWS SDK classes are the ones LOFT accepts
export async function useOwnLibraries(manifests: Interface.ManifestManager): Promise<void> {
  await manifests.useLlmManifestSchema('smoke', z.object({ temperature: z.number() }));
  new SQSStrategy(new SQSClient({ region: 'us-east-1' }), 'https://smoke');
}

// The experimental streaming types come through the packages' declarations
export async function streamEvents(chat: ReturnType<ChatConstructor['getInstance']>, sessionId: string): Promise<void> {
  await chat.generate({ sessionId, onEvent: (e) => void e.type });
}

export function buildLoft() {
  const rateLimit = { newTokensPerSecond: 1, newRequestsPerSecond: 1, maxTokens: 1, maxRequests: 1, maxAwaitSeconds: 1 };
  const call = new OpenAiCallStrategy('key', new LlmTokenRateLimiter(rateLimit), new LlmTokenizer());
  const callManager = new GenerateCallManager('smoke', { highPriorityTasksLimit: 1, retryDelay: 0, retryAttemptsLimit: 1 }, call);
  void [OpenAiLoftStrategy, AnthropicLoftStrategy, GeminiLoftStrategy, OrchestratorBuilder, callManager];
  void [AwsS3RepositoryConstructor, AzureBlobStorageRepository, GcpStorageRepository];
  const chat = new ChatConstructor(
    new SessionRepositoryConstructor(new SessionPostgresDialect({ pool: {} as never }), { schema: 'loft_session' }),
    new ChatHistoryRepositoryConstructor(new ChatHistoryPostgresDialect({ pool: {} as never }), { schema: 'loft_history' })
  );
  const manifests = new ManifestManagerConstructor(new FsRepositoryConstructor(), {
    manifestPath: 'manifest.json',
    errorPath: 'error.json',
    cacheExpirationTime: 1000
  });
  return new LoftConstructor({}, manifests, chat);
}
`;

const root = resolve(import.meta.dirname, '..');
const rootPkg = readJson(join(root, 'package.json'));
const workDir = mkdtempSync(join(tmpdir(), `loft-consumer-${manager}-`));
const tarballDir = join(workDir, 'tarballs');
const appDir = join(workDir, 'app');
const failures = [];

try {
  // pnpm pack replaces the workspace: ranges with the published versions
  const tarballs = {};
  const peers = {};
  for (const dir of readdirSync(join(root, 'packages'))) {
    const pkgDir = join(root, 'packages', dir);
    if (!existsSync(join(pkgDir, 'package.json'))) continue;
    const pkg = readJson(join(pkgDir, 'package.json'));
    if (pkg.private) continue;
    const packed = JSON.parse(run('pnpm', ['pack', '--json', '--pack-destination', tarballDir], pkgDir));
    tarballs[pkg.name] = `file:${packed.filename}`;
    for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
      if (!name.startsWith('@moc-global/') && !pkg.peerDependenciesMeta?.[name]?.optional) peers[name] = range;
    }
  }

  const dependencies = { ...tarballs, ...peers };
  const app = {
    name: 'loft-consumer',
    version: '1.0.0',
    private: true,
    dependencies,
    devDependencies: {
      '@types/node': rootPkg.devDependencies['@types/node'],
      typescript: rootPkg.devDependencies.typescript
    },
    // The packages depend on each other by version; resolve those to the tarballs, not the registry
    ...(manager === 'npm' && { overrides: tarballs }),
    ...(manager === 'yarn' && { resolutions: tarballs })
  };
  write(join(appDir, 'package.json'), JSON.stringify(app, null, 2));
  if (manager === 'pnpm') {
    // A dependency's skipped build script is a warning, as in a consumer project that has not approved it
    write(join(appDir, 'pnpm-workspace.yaml'), `strictDepBuilds: false\noverrides:\n${yamlMap(tarballs)}`);
  }
  if (manager === 'yarn') {
    write(join(appDir, 'yarn.lock'), '');
    // Yarn makes installs immutable when CI is set, and this project's lockfile starts empty
    write(
      join(appDir, '.yarnrc.yml'),
      'nodeLinker: node-modules\nenableTelemetry: false\nenableImmutableInstalls: false\n'
    );
  }
  write(join(appDir, 'tsconfig.json'), JSON.stringify(TSCONFIG, null, 2));
  write(join(appDir, 'tsconfig.nodenext.json'), JSON.stringify(TSCONFIG_NODENEXT, null, 2));
  write(join(appDir, 'consumer.ts'), CONSUMER_TS);
  write(join(appDir, 'consumer.mts'), CONSUMER_TS);
  write(join(appDir, 'load.cjs'), loadScript('require', Object.keys(tarballs)));
  write(join(appDir, 'load.mjs'), loadScript('import', Object.keys(tarballs)));

  const install = {
    npm: ['npm', ['install', '--no-audit', '--no-fund']],
    pnpm: ['pnpm', ['install']],
    yarn: ['npx', ['--yes', `--package=@yarnpkg/cli-dist@${YARN_VERSION}`, 'yarn', 'install']]
  }[manager];
  step('install', () => run(...install, appDir));
  step('tsc (CommonJS, node10 resolution)', () => run(join(appDir, 'node_modules/.bin/tsc'), ['-p', '.'], appDir));
  step('tsc (nodenext resolution, CommonJS and ES module)', () =>
    run(join(appDir, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.nodenext.json'], appDir)
  );
  step('load through require', () => run('node', ['load.cjs'], appDir));
  step('load through import', () => run('node', ['load.mjs'], appDir));
  step('one copy of each shared library', () =>
    checkSingleCopies(Object.keys(tarballs), [...Object.keys(peers), ...Object.keys(tarballs)])
  );
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed with ${manager}:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}

// Walks up from the app and from each package as Node's resolution does, ignoring exports, and records
// where each shared library is found, whether a package declares it as a peer or as a dependency
function checkSingleCopies(packages, shared) {
  const copies = new Map(shared.map((name) => [name, new Set()]));
  for (const name of shared) copies.get(name).add(findPackage(appDir, name));
  for (const pkgName of packages) {
    const pkgDir = realpathSync(join(appDir, 'node_modules', pkgName));
    const pkg = readJson(join(pkgDir, 'package.json'));
    const declared = { ...pkg.dependencies, ...pkg.peerDependencies };
    for (const [name, range] of Object.entries(declared)) {
      if (range.startsWith('workspace:')) throw new Error(`${pkgName} was packed with ${name}@${range}`);
      if (copies.has(name)) copies.get(name).add(findPackage(pkgDir, name));
    }
  }
  const duplicated = [...copies].filter(([, dirs]) => dirs.size > 1);
  if (duplicated.length > 0) {
    throw new Error(duplicated.map(([name, dirs]) => `${name}: ${[...dirs].join(', ')}`).join('\n'));
  }
}

function findPackage(fromDir, name) {
  for (let dir = fromDir; dir !== dirname(dir); dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) return dirname(realpathSync(candidate));
  }
  return undefined;
}

function loadScript(condition, packages) {
  const load = condition === 'require' ? 'require(name)' : 'await import(name)';
  return `${condition === 'require' ? '' : '// ES module\n'}const packages = ${JSON.stringify(packages)};
const loaded = {};
for (const name of packages) loaded[name] = ${load};
// langfuse is an optional peer and is not installed: the package loads, and only the tracer asks for it
const { LangfuseTracer } = loaded['@moc-global/loft'];
let message = '';
try {
  new LangfuseTracer({ secretKey: 'sk', publicKey: 'pk' });
} catch (error) {
  message = error.message;
}
if (!message.includes('npm install langfuse')) throw new Error('LangfuseTracer did not report the missing langfuse: ' + message);
console.log('loaded ' + packages.length + ' packages through ${condition}');
`;
}

function step(name, action) {
  try {
    action();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(
      `FAIL ${name}\n${error.stdout ?? ''}${error.stderr ?? ''}${error.stdout || error.stderr ? '' : error.message}`
    );
  }
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content.endsWith('\n') ? content : `${content}\n`);
}

function yamlMap(map) {
  return Object.entries(map)
    .map(([key, value]) => `  '${key}': '${value}'\n`)
    .join('');
}
