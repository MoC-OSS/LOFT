import { describe, expect, it } from 'vitest';

import { FsRepository } from '../../../base-components';

describe('FsRepository', () => {
  const repository = new FsRepository();

  it('rejects with an Error that has the read failure as its cause', async () => {
    const error = await repository.get('no/such/manifest.json').catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Error reading/parsing JSON from no/such/manifest.json');
    expect((error as Error).cause).toMatchObject({ code: 'ENOENT' });
  });

  it('rejects with an Error that has the write failure as its cause', async () => {
    // A directory cannot be created under package.json, which is a file
    const error = await repository.upload('package.json/manifest.json', {}).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Error writing JSON to package.json/manifest.json');
    expect((error as Error).cause).toBeInstanceOf(Error);
  });

  it('rejects with an Error that has the delete failure as its cause', async () => {
    const error = await repository.remove('no/such/dir/manifest.json').catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Error deleting JSON at no/such/dir/manifest.json');
    expect((error as Error).cause).toMatchObject({ code: 'ENOENT' });
  });
});
