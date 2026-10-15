export interface LoftQueue {
  publish: (message: string) => Promise<void>;
  consume: () => Promise<string | undefined>;

  /**
   * @param worker Function to be called when a message is received
   * @returns Promise Void
   */
  subscribe: (worker: (message: unknown) => Promise<void>) => Promise<void>;
}
