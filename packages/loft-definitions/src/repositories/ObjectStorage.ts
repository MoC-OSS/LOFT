export interface ObjectStorage {
  get: (filePath: string) => Promise<Record<string, any>>;
  upload: (filePath: string, data: Record<string, any>) => Promise<void>;
  remove: (filePath: string) => Promise<void>;
  checkHealth(): Promise<boolean>;
}
