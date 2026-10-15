import { describe, expect, it } from 'vitest';

import { resolveMigrationForVersion } from '../../versions';

const SESSION_MIGRATIONS = ['1.0.0', '1.0.2', '1.1.0', '1.2.0'];

describe('resolveMigrationForVersion', () => {
  it.each([
    { version: '1.2.5', expected: '1.2.0' },
    { version: '1.2.0', expected: '1.2.0' },
    { version: '1.1.9', expected: '1.1.0' },
    { version: '1.0.1', expected: '1.0.0' },
    { version: '1.0.10', expected: '1.0.2' },
    { version: '2.0.0', expected: '1.2.0' },
    { version: '1.3.0-beta.1', expected: '1.2.0' }
  ])('maps library $version to migration $expected', ({ version, expected }) => {
    expect(resolveMigrationForVersion(SESSION_MIGRATIONS, version)).toBe(expected);
  });

  it('does not depend on the order of the names', () => {
    expect(resolveMigrationForVersion(['1.2.0', '1.0.0', '1.10.0', '1.9.0'], '1.10.3')).toBe('1.10.0');
  });

  it('ignores names that are not versions', () => {
    expect(resolveMigrationForVersion(['1.0.0', 'add-index', '1.1.0'], '1.1.0')).toBe('1.1.0');
  });

  it('rejects a library version older than every migration', () => {
    expect(() => resolveMigrationForVersion(SESSION_MIGRATIONS, '0.9.0')).toThrow(
      'No migration matches library version 0.9.0'
    );
  });

  it('rejects a library version that is not x.y.z', () => {
    expect(() => resolveMigrationForVersion(SESSION_MIGRATIONS, 'latest')).toThrow('is not a semantic version');
  });
});
