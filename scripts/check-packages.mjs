/* eslint-env node */
// Runs a package checker over every publishable package.
// Usage: node scripts/check-packages.mjs publint|attw
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Each checker's CLI file, run with the current node binary so nothing is looked up on PATH
const commands = {
  publint: { pkg: 'publint', bin: 'publint', args: (dir) => [dir] },
  attw: { pkg: '@arethetypeswrong/cli', bin: 'attw', args: (dir) => ['--pack', dir] }
};

const tool = process.argv[2];
if (!(tool in commands)) {
  console.error(`Usage: node scripts/check-packages.mjs ${Object.keys(commands).join('|')}`);
  process.exit(2);
}

const rootDir = resolve(import.meta.dirname, '..');
const packagesDir = join(rootDir, 'packages');
const checker = commands[tool];
const checkerDir = join(rootDir, 'node_modules', checker.pkg);
const checkerCli = join(
  checkerDir,
  JSON.parse(readFileSync(join(checkerDir, 'package.json'), 'utf8')).bin[checker.bin]
);
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

  console.log(`\n=== ${pkg.name}`);
  const result = spawnSync(process.execPath, [checkerCli, ...checker.args(pkgDir)], { stdio: 'inherit' });
  if (result.status !== 0) failures.push(pkg.name);
}

if (failures.length > 0) {
  console.error(`\n${tool} failed for: ${failures.join(', ')}`);
  process.exit(1);
}
