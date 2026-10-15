/* eslint-env node */
// Loads every publishable package through its "import" and "require" entry points, as a consumer would,
// then constructs each package's main classes from the loaded modules. Construction catches interop bugs
// that loading alone misses, such as a CommonJS default import that is not a constructor.
// Nothing here opens a network connection.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const packagesDir = resolve(import.meta.dirname, '../packages');
// LOFT writes a manifest error dump into the working directory when it cannot load the manifest
const workDir = mkdtempSync(join(tmpdir(), 'loft-smoke-'));
process.chdir(workDir);
// An empty but valid manifest, so the LOFT recipe loads it instead of logging a missing file
writeFileSync(join(workDir, 'smoke.json'), JSON.stringify({ llmManifests: {}, prompts: {}, aiTasks: {} }));
const failures = [];
const loaded = { import: {}, require: {} };

for (const dir of readdirSync(packagesDir)) {
  const pkgDir = join(packagesDir, dir);
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  const entry = pkg.exports?.['.'];
  if (pkg.private || !entry) continue;

  const require = createRequire(join(pkgDir, 'package.json'));
  // Each condition is a path, or { types, default } when it has its own types
  const target = (condition) => (typeof condition === 'string' ? condition : condition?.default);
  const checks = [
    ['import', target(entry.import), (file) => import(pathToFileURL(join(pkgDir, file)).href)],
    ['require', target(entry.require), (file) => require(join(pkgDir, file))]
  ];

  for (const [condition, file, load] of checks) {
    if (!file) continue;
    try {
      loaded[condition][pkg.name] = await load(file);
      console.log(`ok   ${pkg.name} (${condition})`);
    } catch (error) {
      failures.push(`${pkg.name} (${condition})`);
      console.error(`FAIL ${pkg.name} (${condition}): ${firstLine(error)}`);
    }
  }
}

const rateLimit = { newTokensPerSecond: 1, newRequestsPerSecond: 1, maxTokens: 1, maxRequests: 1, maxAwaitSeconds: 1 };
const callConfig = { highPriorityTasksLimit: 1, retryDelay: 0, retryAttemptsLimit: 1 };
const AZURE_CONNECTION =
  'DefaultEndpointsProtocol=https;AccountName=smoke;AccountKey=c21va2U=;EndpointSuffix=core.windows.net';

// Each recipe gets the package's module and a lookup for the other packages loaded the same way,
// and returns the objects it constructed; the runner checks that they are objects
const recipes = {
  '@moc-global/loft-definitions': (m) => [new m.Logger('smoke'), new m.NativeCallManagerStrategy({})],
  '@moc-global/loft-llm-call-manager': (m) => {
    const limiter = new m.LlmTokenRateLimiter(rateLimit);
    const manager = new m.GenerateCallManager('smoke', callConfig, { tokenRateLimiter: limiter });
    const queue = { consume: async () => undefined, publish: async () => {}, subscribe: async () => {} };
    const queued = new m.GenerateWithQueueManager(
      'smoke',
      { ...callConfig, minPollerInterval: 1000, maxPollerInterval: 2000, pollerTimeCoefficient: 2 },
      { tokenRateLimiter: limiter },
      queue,
      queue
    );
    queued.stop();
    manager.stop();
    return [limiter, manager, queued, new m.LlmTokenizer()];
  },
  '@moc-global/loft-anthropic-strategy': (m, pkg) => {
    const cm = pkg('@moc-global/loft-llm-call-manager');
    const call = new m.AnthropicCallStrategy(
      { apiKey: 'smoke' },
      new cm.LlmTokenRateLimiter(rateLimit),
      new cm.LlmTokenizer()
    );
    call.tokenRateLimiter.stop();
    return [call, new m.AnthropicLoftStrategy({ llmName: 'smoke' }, callManager(pkg, call))];
  },
  '@moc-global/loft-openai-strategy': (m, pkg) => {
    const cm = pkg('@moc-global/loft-llm-call-manager');
    const call = new m.OpenAiCallStrategy('smoke', new cm.LlmTokenRateLimiter(rateLimit), new cm.LlmTokenizer());
    const azure = new m.AzureOpenAiCallStrategy(
      { endpoint: 'https://smoke.openai.azure.com', auth: { type: 'api-key', apiKey: 'smoke' } },
      new cm.LlmTokenRateLimiter(rateLimit),
      new cm.LlmTokenizer()
    );
    call.tokenRateLimiter.stop();
    azure.tokenRateLimiter.stop();
    return [
      call,
      new m.OpenAiLoftStrategy({ llmName: 'smoke' }, callManager(pkg, call)),
      azure,
      new m.AzureOpenAiLoftStrategy({ llmName: 'smoke' }, callManager(pkg, azure))
    ];
  },
  '@moc-global/loft-gemini-strategy': (m, pkg) => {
    const cm = pkg('@moc-global/loft-llm-call-manager');
    const call = new m.GeminiCallStrategy(
      { mode: 'apikey', apiKey: 'smoke' },
      new cm.LlmTokenRateLimiter(rateLimit),
      new cm.LlmTokenizer()
    );
    call.tokenRateLimiter.stop();
    return [call, new m.GeminiLoftStrategy({ llmName: 'smoke' }, callManager(pkg, call))];
  },
  '@moc-global/loft-aws-s3-repository': (m) => [new m.AwsS3Repository({ region: 'us-east-1', bucketName: 'smoke' })],
  '@moc-global/loft-gcp-storage-repository': (m) => [
    new m.GcpStorageRepository({ projectId: 'smoke', bucketName: 'smoke' })
  ],
  '@moc-global/loft-azure-blob-storage-repository': (m) => [
    new m.AzureBlobStorageRepository({ connectionString: AZURE_CONNECTION, containerName: 'smoke' })
  ],
  '@moc-global/loft-queue-sqs-strategy': (m) => [
    new m.SQSStrategy(new m.SQSClient({ region: 'us-east-1' }), 'https://smoke')
  ],
  '@moc-global/loft-session-pg-repository': (m) => [
    new m.SessionRepositoryConstructor(new m.SessionPostgresDialect({ pool: {} }), { schema: 'smoke' })
  ],
  '@moc-global/loft-chat-history-pg-repository': (m) => [
    new m.ChatHistoryRepositoryConstructor(new m.ChatHistoryPostgresDialect({ pool: {} }), { schema: 'smoke' })
  ],
  '@moc-global/loft-agents': (m) => [new m.OrchestratorBuilder()],
  // The whole DI graph an application builds, as in examples/express-basic
  '@moc-global/loft': async (m, pkg) => {
    const session = pkg('@moc-global/loft-session-pg-repository');
    const history = pkg('@moc-global/loft-chat-history-pg-repository');
    const chat = new m.ChatConstructor(
      new session.SessionRepositoryConstructor(new session.SessionPostgresDialect({ pool: {} }), { schema: 'smoke' }),
      new history.ChatHistoryRepositoryConstructor(new history.ChatHistoryPostgresDialect({ pool: {} }), {
        schema: 'smoke'
      })
    );
    const manifests = new m.ManifestManagerConstructor(new m.FsRepositoryConstructor(), {
      manifestPath: 'smoke.json',
      errorPath: 'smoke-error.json',
      cacheExpirationTime: 1000
    });
    // ERROR keeps lifecycle logs and the expected "LLM not in the manifest" warning out of the output
    const { LogLevel } = pkg('@moc-global/loft-definitions').Interface;
    const loftConstructor = new m.LoftConstructor({ logLevel: LogLevel.ERROR }, manifests, chat);
    const openai = pkg('@moc-global/loft-openai-strategy');
    const cm = pkg('@moc-global/loft-llm-call-manager');
    const call = new openai.OpenAiCallStrategy('smoke', new cm.LlmTokenRateLimiter(rateLimit), new cm.LlmTokenizer());
    await loftConstructor.registerLlmStrategy(
      'smoke',
      new openai.OpenAiLoftStrategy({ llmName: 'smoke' }, callManager(pkg, call))
    );
    const loft = loftConstructor.getInstance();
    await loft.shutdown();
    // Loads the optional langfuse peer itself, from each build
    const tracer = new m.LangfuseTracer({ publicKey: 'smoke', secretKey: 'smoke', enabled: false });
    return [loftConstructor, loft, tracer];
  }
};

function callManager(pkg, callStrategy) {
  const cm = pkg('@moc-global/loft-llm-call-manager');
  const definitions = pkg('@moc-global/loft-definitions');
  return new definitions.NativeCallManagerStrategy(new cm.GenerateCallManager('smoke', callConfig, callStrategy));
}

for (const condition of ['import', 'require']) {
  const pkg = (name) => {
    if (!loaded[condition][name]) throw new Error(`${name} did not load`);
    return loaded[condition][name];
  };
  for (const [name, mod] of Object.entries(loaded[condition])) {
    const recipe = recipes[name];
    if (!recipe) {
      failures.push(`${name} (${condition}): no construct recipe`);
      console.error(`FAIL ${name} (${condition}): no construct recipe in scripts/smoke-imports.mjs`);
      continue;
    }
    try {
      const constructed = await recipe(mod, pkg);
      if (!Array.isArray(constructed) || constructed.length === 0 || !constructed.every(isObject)) {
        throw new Error('the recipe did not return the objects it constructed');
      }
      console.log(`ok   ${name} constructs (${condition})`);
    } catch (error) {
      failures.push(`${name} constructs (${condition})`);
      console.error(`FAIL ${name} constructs (${condition}): ${firstLine(error)}`);
    }
  }
}

// Bundlers such as esbuild pick the ES module build for an import even when they write CommonJS, as for AWS Lambda.
// The bundle must load, and LangfuseTracer must work with the langfuse class the application passes in.
const bundleFile = join(workDir, 'bundle.cjs');
try {
  const { build } = await import('esbuild');
  const loftEsm = join(packagesDir, 'loft/lib/index.mjs');
  await build({
    stdin: {
      contents: [
        "import 'reflect-metadata';",
        `import { LangfuseTracer, LoftConstructor } from ${JSON.stringify(loftEsm)};`,
        "import { Langfuse } from 'langfuse';",
        "if (typeof LoftConstructor !== 'function') throw new Error('LoftConstructor is missing');",
        "new LangfuseTracer({ publicKey: 'smoke', secretKey: 'smoke', enabled: false }, { Langfuse });"
      ].join('\n'),
      resolveDir: join(packagesDir, 'loft'),
      sourcefile: 'app.mjs'
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundleFile,
    // The bundle has no import.meta; that is what this check is about
    logLevel: 'error'
  });
  createRequire(bundleFile)(bundleFile);
  console.log('ok   @moc-global/loft ES module build bundled to CommonJS');
} catch (error) {
  failures.push('@moc-global/loft ES module build bundled to CommonJS');
  console.error(`FAIL @moc-global/loft ES module build bundled to CommonJS: ${firstLine(error)}`);
}

rmSync(workDir, { recursive: true, force: true });

function isObject(value) {
  return typeof value === 'object' && value !== null;
}

function firstLine(error) {
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
