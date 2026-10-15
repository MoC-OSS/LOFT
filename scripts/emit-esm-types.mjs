/* eslint-env node */
// Writes an ES module twin (.d.mts) of every .d.ts file in a package's lib/, so code that imports the package
// gets types for the .mjs build and code that requires it keeps the .d.ts files. tsc emits
// extensionless relative paths, which ES module resolution rejects, so each one is pointed at the .mjs
// file it stands for. Run from a package directory after `tsc -p tsconfig.declarations.json`.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const libDir = resolve(process.argv[2] ?? 'lib');
// from '…', import '…' and import('…'), with a path that starts with . or ..
const RELATIVE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}(?:\/[^'"]*)?)\2/g;
const SOURCE_MAP = /^\/\/# sourceMappingURL=.*$/m;

let written = 0;
for (const file of declarationFiles(libDir)) {
  const source = readFileSync(file, 'utf8');
  const esm = source
    .replace(RELATIVE, (_, keyword, quote, path) => `${keyword}${quote}${toModulePath(file, path)}${quote}`)
    // The .d.ts.map files describe the .d.ts files, not their twins
    .replace(SOURCE_MAP, '');
  writeFileSync(file.replace(/\.d\.ts$/, '.d.mts'), esm);
  written++;
}
if (written === 0) throw new Error(`No .d.ts files in ${libDir}; run tsc first`);
console.log(`Wrote ${written} .d.mts files in ${libDir}`);

function toModulePath(file, path) {
  const target = resolve(dirname(file), path);
  if (existsSync(`${target}.d.ts`)) return `${path}.mjs`;
  if (existsSync(join(target, 'index.d.ts'))) return `${path.replace(/\/$/, '')}/index.mjs`;
  throw new Error(`${file}: cannot resolve '${path}' to a declaration file`);
}

function* declarationFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* declarationFiles(path);
    else if (name.endsWith('.d.ts')) yield path;
  }
}
