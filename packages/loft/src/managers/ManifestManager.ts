import { DI_TYPES, Interface, Logger, Repository, Schema, Type } from '@moc-global/loft-definitions';
import { inject, injectable } from 'inversify';
import { ZodObject } from 'zod';

import { createNewPathWithSortableFileName, isJSON } from '../base-components/utils';

@injectable()
export class ManifestManager implements Interface.ManifestManager {
  private cachedManifest?: Type.LoftManifest;
  private expiredAt: number = 0;
  private llmManifestSchemas: Map<string, ZodObject<any>> = new Map();
  private readonly log = new Logger(ManifestManager.name);

  private currentUpdatePromise?: Promise<void>;
  // Serialises concurrent useLlmManifestSchema calls via a Promise chain instead of throwing.
  private registrationQueue: Promise<void> = Promise.resolve();

  constructor(
    @inject(DI_TYPES.ManifestRepository) private readonly manifestRepository: Repository.ObjectStorage,
    @inject(DI_TYPES.ManifestManagerConfig) private readonly manifestManagerConfig: Interface.ManifestManagerConfig
  ) {
    this.log.trace('Manifest Manager initialized. Update cache...');
    // Try to load cache on init, but don't fail constructor if it fails
    this.initializeCache();
  }

  private initializeCache(): void {
    // Start cache update with safe wrapper to prevent constructor failure
    // Errors are already handled in createSafeUpdatePromise
    this.currentUpdatePromise = this.createSafeUpdatePromise();
  }

  async useLlmManifestSchema(llmName: string, schema: ZodObject<any>): Promise<void> {
    // Append to the registration queue so concurrent callers are serialised
    // transparently rather than throwing. The caller awaits `next` (which
    // propagates errors); `registrationQueue` is kept alive by catching errors.
    const next = this.registrationQueue.then(() => this.doRegisterSchema(llmName, schema));
    this.registrationQueue = next.catch(() => {});
    return next;
  }

  private async doRegisterSchema(llmName: string, schema: ZodObject<any>): Promise<void> {
    // Wait for any in-flight cache update to finish before modifying schemas
    if (this.currentUpdatePromise) {
      await this.currentUpdatePromise;
    }

    this.log.trace(`Registering LLM Manifest Schema: ${llmName}`);
    if (this.llmManifestSchemas.has(llmName)) {
      this.log.warn(`Overwriting existing Manifest Validation Schema for ${llmName}`);
    }

    // Register the schema
    this.llmManifestSchemas.set(llmName, schema);

    // If we have cached manifests, validate only the entries for this specific LLM
    if (this.cachedManifest?.llmManifests) {
      let foundInAnyManifest = false;

      Object.entries(this.cachedManifest.llmManifests).forEach(([manifestName, manifest]) => {
        const llmManifest = manifest[llmName];

        if (llmManifest?.modelPreset) {
          foundInAnyManifest = true;
          try {
            // Validate and update the cached manifest entry
            const validatedModelPreset = schema.parse(llmManifest.modelPreset);
            manifest[llmName] = {
              modelPreset: validatedModelPreset,
              systemMessage: llmManifest.systemMessage
            };
            this.log.debug(`Validated cached manifest for ${llmName} in ${manifestName}`);
          } catch (error: unknown) {
            // Invalid manifest data during LLM registration is a fatal error
            const errorMessage = `Invalid manifest data for LLM "${llmName}" in manifest "${manifestName}": ${(error as Error).message}`;
            this.log.fatal(errorMessage, error);
            throw new Error(errorMessage);
          }
        }
      });

      if (!foundInAnyManifest) {
        // LLM not in any manifest yet - warn but allow registration
        this.log.warn(
          `LLM strategy "${llmName}" registered but not found in any manifest - will validate when manifest is updated`
        );
      }
    }
  }

  private isManifestExpired() {
    return new Date().getTime() >= this.expiredAt;
  }

  private async getManifest(): Promise<Type.LoftManifest> {
    this.log.trace('Getting Manifest');

    if (this.isManifestExpired()) {
      this.log.trace('Manifest expired, updating...');
      await this.updateCache();
    }

    if (!this.cachedManifest || !this.cachedManifest.llmManifests) {
      throw new Error('Manifest or LLM Manifests not found');
    }
    return this.cachedManifest;
  }

  private getManifestByName(manifest: Type.LoftManifest, manifestName: string): Type.LLMManifests {
    const manifestByName = manifest.llmManifests[manifestName];
    if (!manifestByName) {
      throw new Error(`Manifest by name: ${manifestName} not found`);
    }
    return manifestByName;
  }
  private getAiTaskByName(manifest: Type.LoftManifest, manifestName: string): Type.LLMManifests {
    const manifestByName = manifest.aiTasks[manifestName];
    if (!manifestByName) {
      throw new Error(`Manifest by name: ${manifestName} not found`);
    }
    return manifestByName;
  }

  private getLlmManifestByName(manifestByName: Type.LLMManifests, llmName: string): Type.LLMManifestProps {
    const llmManifest = manifestByName[llmName];
    if (!llmManifest) {
      throw new Error(`No agent manifest found with declared LLM usage for: ${llmName}`);
    }
    return llmManifest;
  }

  async getPrompt(promptName: string, llmName: string): Promise<Interface.Prompt> {
    this.log.trace('Getting Prompt by name');
    const manifest = await this.getManifest();
    // Manifest shape: prompts[promptName][llmName]
    const promptContent = manifest.prompts[promptName]?.[llmName];

    if (!promptContent) throw new Error(`prompt with name ${promptName} is not exist in manifest`);

    const prompt: Interface.Prompt = {
      name: promptName,
      content: promptContent
    };

    return prompt;
  }

  validateManifests(manifestObject: Type.Manifest): Type.Manifest {
    const validatedManifests: Type.Manifest = {};

    Object.keys(manifestObject).forEach((manifestName) => {
      const validatedLlmManifests: Type.LLMManifests = {};
      const manifest = manifestObject[manifestName];

      // First, validate all existing manifest entries
      Object.keys(manifest).forEach((llmName) => {
        const llmManifest = manifest[llmName];
        const schema = this.llmManifestSchemas.get(llmName);

        if (!schema) {
          // LLM strategy not registered yet - keep the manifest data as is
          // It will be validated when the strategy is registered
          // Normal at startup: the manifest loads before the strategies register, and each registration
          // validates the entries for its LLM (doRegisterSchema)
          this.log.debug(
            `Manifest entry for LLM "${llmName}" in "${manifestName}" will be validated when its strategy registers`
          );
          validatedLlmManifests[llmName] = llmManifest;
          return;
        }

        // Validate with the registered schema
        try {
          const validatedModelPreset = schema.parse(llmManifest.modelPreset);
          validatedLlmManifests[llmName] = {
            modelPreset: validatedModelPreset,
            systemMessage: llmManifest.systemMessage
          };
        } catch (error: unknown) {
          // Invalid manifest data for registered LLM - this is a fatal error
          this.log.error(`Invalid LLM Manifest for ${llmName} in ${manifestName}:`, error);
          throw new Error(`Invalid LLM Manifest for ${llmName}: ${(error as Error).message}`);
        }
      });

      // Then check if registered LLMs have manifests (warning only)
      this.llmManifestSchemas.forEach((_schema, llmName) => {
        if (!manifest[llmName]?.modelPreset) {
          this.log.warn(`Manifest file is missing manifest for registered LLM strategy`, {
            llmName,
            manifestName
          });
        }
      });

      validatedManifests[manifestName] = validatedLlmManifests;
    });

    return validatedManifests;
  }

  private createSafeUpdatePromise(): Promise<void> {
    // Wrapper that adds error handling and cleanup to _doUpdateCache
    return this._doUpdateCache()
      .catch((error) => {
        // Log error but keep existing cache if available (better stale than nothing)
        this.log.error('Cache update failed:', error);
        this.log.warn('For resilience, extending expired cache lifetime by 5 minute and will retry update');
        // Set expiration to 1 minute from now to retry soon but not immediately
        this.expiredAt = new Date().getTime() + 5 * 60000; // 5 minutes
      })
      .finally(() => {
        // Clear the promise when done (success or failure)
        this.currentUpdatePromise = undefined;
      });
  }

  /**
   * Loads and validates the manifests now and rejects when that fails. Unlike updateCache(), which keeps the stale
   * cache on a failed load, it reports the error to the caller.
   */
  async validate(): Promise<void> {
    if (this.currentUpdatePromise) {
      await this.currentUpdatePromise;
    }
    await this._doUpdateCache();
  }

  async updateCache(): Promise<void> {
    // If there's already an update in progress, wait for it
    if (this.currentUpdatePromise) {
      await this.currentUpdatePromise;
      return;
    }

    // Start new update with safe wrapper
    this.currentUpdatePromise = this.createSafeUpdatePromise();
    await this.currentUpdatePromise;
  }

  private async _doUpdateCache(): Promise<void> {
    try {
      this.log.trace('Updating Manifest Data');
      this.log.trace(`Getting Manifest Data from Repository: ${this.manifestManagerConfig.manifestPath}`);
      const rawData = await this.manifestRepository.get(this.manifestManagerConfig.manifestPath);
      const validatedRawData = Schema.LoftManifest.parse(rawData);
      validatedRawData.llmManifests = this.validateManifests(validatedRawData.llmManifests);
      validatedRawData.aiTasks = this.validateManifests(validatedRawData.aiTasks);
      //todo: validate prompts

      this.cachedManifest = validatedRawData;
      this.log.trace('Manifest Data updated');

      this.expiredAt = new Date(new Date().getTime() + this.manifestManagerConfig.cacheExpirationTime).getTime();
    } catch (error: any) {
      this.log.error('Error updating Manifest Cache:', error.message, error.stack);

      let errorMessage: Record<string, any>;
      if (isJSON(error.message)) errorMessage = { error: JSON.parse(error.message) };
      else errorMessage = { error: error.message };
      // For example the JSON parse error behind "Error reading/parsing JSON from <path>"
      if (error.cause?.message) errorMessage.cause = error.cause.message;

      const errorFilePath = createNewPathWithSortableFileName(this.manifestManagerConfig.errorPath);
      await this.manifestRepository.upload(errorFilePath, errorMessage);
      throw error;
    }
  }

  public async getLlmManifest(manifestName: string, llmName: string): Promise<Type.LLMManifestProps> {
    this.log.trace(`Getting System Message by LLM name: ${llmName} manifest name: `, manifestName);
    const manifest = await this.getManifest();

    const manifestByName = this.getManifestByName(manifest, manifestName);

    const llmManifest = this.getLlmManifestByName(manifestByName, llmName);

    if (!llmManifest.systemMessage) {
      throw new Error('System Message not found');
    }

    return llmManifest;
  }

  public async getAiTaskManifest(manifestName: string, llmName: string): Promise<Type.LLMManifestProps> {
    this.log.trace('Getting AI Task by name and LLM name');
    const manifest = await this.getManifest();
    const manifestByName = this.getAiTaskByName(manifest, manifestName);
    const aiTaskManifest = this.getLlmManifestByName(manifestByName, llmName);

    if (!aiTaskManifest.systemMessage) {
      throw new Error('AI Task not found');
    }

    return aiTaskManifest;
  }
}
