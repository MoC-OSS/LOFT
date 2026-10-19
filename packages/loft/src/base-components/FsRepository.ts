import 'reflect-metadata';

import { Logger, Repository } from '@moc-global/loft-definitions';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { injectable } from 'inversify';
import * as path from 'path';

import { extractDirectoryPath } from './utils';

@injectable()
export class FsRepository implements Repository.ObjectStorage {
  private readonly log = new Logger('FsRepository');

  constructor() {}
  async get(filePath: string): Promise<any> {
    try {
      this.log.trace(`Reading file ${filePath}`);
      // Read the content of the file using the promise-based version
      const pathToManifest = path.join(process.cwd(), filePath);
      const dataString: string = await readFile(pathToManifest, 'utf8');

      this.log.trace(`Parsing JSON from file ${filePath}`);
      const data = JSON.parse(dataString);

      this.log.trace(`Returning data from file ${filePath}`);
      return data;
    } catch (error) {
      // The caller logs it; ManifestManager does
      throw new Error(`Error reading/parsing JSON from ${filePath}`, { cause: error });
    }
  }

  async upload(filePath: string, data: Record<string, any>): Promise<void> {
    try {
      this.log.trace(`Writing file ${filePath}`);
      // Write the content of the file using the promise-based version
      const pathToManifest = path.join(process.cwd(), filePath);
      // Ensure the directory exists
      await mkdir(extractDirectoryPath(pathToManifest), { recursive: true });

      const stringifiedData = JSON.stringify(data, null, 2);
      await writeFile(pathToManifest, stringifiedData, 'utf8');
    } catch (error) {
      throw new Error(`Error writing JSON to ${filePath}`, { cause: error });
    }
  }

  async remove(filePath: string): Promise<void> {
    try {
      this.log.trace(`Deleting file ${filePath}`);
      // Delete the file using the promise-based version
      const pathToManifest = path.join(process.cwd(), filePath);
      await writeFile(pathToManifest, '');
    } catch (error) {
      throw new Error(`Error deleting JSON at ${filePath}`, { cause: error });
    }
  }

  async checkHealth(): Promise<boolean> {
    this.log.trace(`Checking health of FsRepository`);
    return true;
  }
}
