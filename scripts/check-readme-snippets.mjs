/* eslint-env node */
// Type-checks every ```typescript block of the root README and of each publishable package's README, so an
// example that no longer matches the API fails CI. Each block compiles as its own module against the built
// declarations (lib/index.d.ts) of the workspace packages, so run it after the build. A block that is not meant
// to compile on its own goes right after a `<!-- snippet-check: skip -->` line.
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const rootDir = resolve(import.meta.dirname, '..');
const packagesDir = join(rootDir, 'packages');
const SKIP_MARKER = '<!-- snippet-check: skip -->';

// Every workspace package resolves to its built declarations; the snippets may import private ones too
const paths = {};
const readmes = [join(rootDir, 'README.md')];
for (const dir of readdirSync(packagesDir)) {
  const pkgDir = join(packagesDir, dir);
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  paths[pkg.name] = [join(pkgDir, 'lib', 'index.d.ts')];
  if (!pkg.private) readmes.push(join(pkgDir, 'README.md'));
}
// Third-party imports such as pg resolve from the root devDependencies
paths['*'] = [join(rootDir, 'node_modules', '*'), join(rootDir, 'node_modules', '@types', '*')];

const workDir = realpathSync(mkdtempSync(join(tmpdir(), 'loft-readme-snippets-')));
// Maps each written module back to the README line its block starts on
const origins = new Map();

for (const readme of readmes) {
  let text;
  try {
    text = readFileSync(readme, 'utf8');
  } catch {
    continue;
  }
  for (const match of text.matchAll(/^```typescript\n([\s\S]*?)^```/gm)) {
    const before = text.slice(0, match.index);
    if (before.trimEnd().endsWith(SKIP_MARKER)) continue;
    const line = before.split('\n').length + 1;
    const file = join(workDir, `${origins.size}.ts`);
    writeFileSync(file, `${match[1]}\nexport {};\n`);
    origins.set(file, { readme: relative(rootDir, readme), line });
  }
}

const program = ts.createProgram([...origins.keys()], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  types: ['node'],
  typeRoots: [join(rootDir, 'node_modules', '@types')],
  paths
});

const errors = [];
for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  const origin = diagnostic.file && origins.get(resolve(diagnostic.file.fileName));
  if (!origin) {
    errors.push(`error TS${diagnostic.code}: ${message}`);
    continue;
  }
  const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
  errors.push(`${origin.readme}:${origin.line + line}: error TS${diagnostic.code}: ${message}`);
}
rmSync(workDir, { recursive: true, force: true });

if (errors.length > 0) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} error(s) in the README snippets`);
  process.exit(1);
}
console.log(`ok ${origins.size} README snippets compile`);
