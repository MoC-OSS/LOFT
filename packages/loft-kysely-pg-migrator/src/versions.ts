function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Finds the migration that matches a library version. Migrations are named after the version that
 * introduced them (1.0.0, 1.2.0), so library 1.3.4 needs migration 1.2.0: the newest one at or below it.
 * A pre-release such as 1.3.0-beta.1 counts as 1.3.0.
 */
export function resolveMigrationForVersion(migrationNames: string[], libraryVersion: string): string {
  const target = parseVersion(libraryVersion);
  if (!target) throw new Error(`Library version "${libraryVersion}" is not a semantic version (x.y.z).`);

  let best: { name: string; version: [number, number, number] } | undefined;
  for (const name of migrationNames) {
    const version = parseVersion(name);
    if (!version || compareVersions(version, target) > 0) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { name, version };
  }

  if (!best) {
    throw new Error(
      `No migration matches library version ${libraryVersion}. Available: ${migrationNames.join(', ') || 'none'}`
    );
  }
  return best.name;
}
