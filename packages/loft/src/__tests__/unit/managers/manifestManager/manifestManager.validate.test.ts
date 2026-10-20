import 'reflect-metadata';

import { Chat, DI_TYPES, Interface, Logger, Repository } from '@moc-global/loft-definitions';
import { ContainerModule } from 'inversify';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { LoftConstructor, ManifestManagerConstructor } from '../../../../constructors';
import { ManifestManager } from '../../../../managers/ManifestManager';

const VALID = {
  llmManifests: { assistant: { scripted: { systemMessage: 'You help.', modelPreset: { model: 'scripted' } } } },
  prompts: {},
  aiTasks: {}
};
const CONFIG = { manifestPath: 'manifest.json', errorPath: 'errors.json', cacheExpirationTime: 60_000 };

function storage(...loads: unknown[]) {
  const get = vi.fn();
  for (const load of loads) get.mockResolvedValueOnce(load);
  return { get, upload: vi.fn().mockResolvedValue(undefined) } as unknown as Repository.ObjectStorage & {
    get: typeof get;
    upload: ReturnType<typeof vi.fn>;
  };
}

function loftConstructorWith(repository: Repository.ObjectStorage) {
  return new LoftConstructor<Chat.ChatInterface>(
    { logLevel: Interface.LogLevel.NONE },
    new ManifestManagerConstructor({ initializeContainer: () => undefined, getInstance: () => repository }, CONFIG)
  );
}

describe('ManifestManager.validate()', () => {
  beforeAll(() => {
    Logger.configure({ logLevel: Interface.LogLevel.NONE });
  });

  it('rejects when the manifests are invalid, and writes the error file', async () => {
    const repository = storage(VALID, { llmManifests: 'not an object' });
    const manager = new ManifestManager(repository, CONFIG);

    await expect(manager.validate()).rejects.toThrow();
    expect(repository.upload).toHaveBeenCalledTimes(1);
  });

  it('rejects when the manifests cannot be loaded', async () => {
    const repository = storage(VALID);
    repository.get.mockRejectedValueOnce(new Error('bucket not found'));
    const manager = new ManifestManager(repository, CONFIG);

    await expect(manager.validate()).rejects.toThrow('bucket not found');
  });

  it('resolves for valid manifests after the first load has finished', async () => {
    const repository = storage(VALID, VALID);
    const manager = new ManifestManager(repository, CONFIG);

    await expect(manager.validate()).resolves.toBeUndefined();
    expect(repository.get).toHaveBeenCalledTimes(2);
  });

  it('keeps updateCache() from rejecting, so a stale cache still serves requests', async () => {
    const repository = storage(VALID, { llmManifests: 'not an object' });
    const manager = new ManifestManager(repository, CONFIG);

    await expect(manager.updateCache()).resolves.toBeUndefined();
  });
});

describe('LoftConstructor.validateManifest()', () => {
  it('rejects when the manifests are invalid', async () => {
    // The first load, started by the manager itself, fails too
    const invalid = { llmManifests: 'not an object' };

    await expect(loftConstructorWith(storage(invalid, invalid)).validateManifest()).rejects.toThrow();
  });

  it('resolves for valid manifests', async () => {
    await expect(loftConstructorWith(storage(VALID, VALID)).validateManifest()).resolves.toBeUndefined();
  });

  it('falls back to updateCache() for a manager without validate()', async () => {
    const updateCache = vi.fn().mockResolvedValue(undefined);
    const managerWithoutValidate = { updateCache } as unknown as Interface.ManifestManager;
    const constructor = new LoftConstructor<Chat.ChatInterface>(
      { logLevel: Interface.LogLevel.NONE },
      {
        getModule: () =>
          new ContainerModule((bind) => {
            bind<Interface.ManifestManager>(DI_TYPES.ManifestManager).toConstantValue(managerWithoutValidate);
          })
      }
    );

    await constructor.validateManifest();

    expect(updateCache).toHaveBeenCalledTimes(1);
  });
});
