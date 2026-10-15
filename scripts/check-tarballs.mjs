/* eslint-env node */
// Lists what `npm pack` would publish for every publishable package and fails if a tarball
// ships tests or sources, grows past the size limit, or lacks the license files: the root LICENSE,
// copied unchanged, and a NOTICE wherever the package directory has one. It also fails if a `bin` target
// or a built migration (one lib/migrations/*.js per src/migrations/*.ts) is missing. Run after the build.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MAX_UNPACKED_BYTES = 5 * 1024 * 1024;
const FORBIDDEN = [
  { pattern: /(^|\/)__tests__\//, reason: 'test file' },
  { pattern: /\.(test|spec)\.[cm]?[jt]s(\.map)?$/, reason: 'test file' },
  { pattern: /^src\//, reason: 'source file' }
];

const rootDir = resolve(import.meta.dirname, '..');
const packagesDir = join(rootDir, 'packages');
const license = readFileSync(join(rootDir, 'LICENSE'), 'utf8');
const failures = [];

for (const dir of readdirSync(packagesDir)) {
  const pkgDir = join(packagesDir, dir);
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  if (pkg.private) continue;

  // npm comes from PATH. This runs only in CI and on developer machines, where the runner or the developer
  // controls PATH, and it passes no outside input; `pnpm pack` has no --dry-run to use instead.
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: pkgDir,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    failures.push(`${pkg.name}: npm pack failed\n${result.stderr}`);
    continue;
  }

  const [tarball] = JSON.parse(result.stdout);
  const problems = tarball.files.flatMap(({ path }) =>
    FORBIDDEN.filter(({ pattern }) => pattern.test(path)).map(({ reason }) => `${reason} ${path}`)
  );
  const packed = new Set(tarball.files.map(({ path }) => path));
  if (!packed.has('LICENSE')) {
    problems.push('no LICENSE');
  } else if (readFileSync(join(pkgDir, 'LICENSE'), 'utf8') !== license) {
    problems.push('LICENSE differs from the root LICENSE');
  }
  if (existsSync(join(pkgDir, 'NOTICE')) && !packed.has('NOTICE')) problems.push('NOTICE is not in files');
  for (const file of requiredFiles(pkgDir, pkg)) {
    if (!packed.has(file)) problems.push(`missing ${file}`);
  }
  if (tarball.unpackedSize > MAX_UNPACKED_BYTES) {
    problems.push(`unpacked size ${(tarball.unpackedSize / 1e6).toFixed(2)} MB is over the 5 MB limit`);
  }

  const size = `${(tarball.unpackedSize / 1e6).toFixed(2)} MB unpacked, ${tarball.entryCount} files`;
  if (problems.length > 0) {
    failures.push(`${pkg.name}:\n  ${problems.slice(0, 10).join('\n  ')}`);
    console.error(`FAIL ${pkg.name} (${size})`);
  } else {
    console.log(`ok   ${pkg.name} (${size})`);
  }
}

// The bin targets, and the built form of each migration: the migrators load lib/migrations at runtime
function requiredFiles(pkgDir, pkg) {
  const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {});
  const migrationsDir = join(pkgDir, 'src', 'migrations');
  const migrations = existsSync(migrationsDir)
    ? readdirSync(migrationsDir)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
        .map((name) => `lib/migrations/${name.replace(/\.ts$/, '.js')}`)
    : [];
  return [...bins.map((path) => path.replace(/^\.\//, '')), ...migrations];
}

if (failures.length > 0) {
  console.error(`\n${failures.join('\n')}`);
  process.exit(1);
}
