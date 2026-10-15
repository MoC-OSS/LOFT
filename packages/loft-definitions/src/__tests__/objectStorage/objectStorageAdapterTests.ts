import { describe, expect, test } from 'vitest';

import { Repository } from '../..';

export function testObjectStorageAdapterRepository(repository: Repository.ObjectStorage) {
  describe('Manifest Adapter Repository Integration Test', () => {
    test('health check', async () => {
      const health = await repository.checkHealth();
      expect(health).toBe(true);
    });

    test('upload test-manifest.json', async () => {
      const manifest = {
        key: 'value'
      };

      await expect(repository.upload('test-manifest.json', manifest)).resolves.toBeUndefined();
    });

    test('get test-manifest.json', async () => {
      const manifest = await repository.get('test-manifest.json');
      expect(manifest).toEqual({
        key: 'value'
      });
    });

    test('remove test-manifest.json', async () => {
      await repository.remove('test-manifest.json');
      await expect(repository.get('test-manifest.json')).rejects.toThrow();
    });
  });
}
