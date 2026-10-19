export interface CustomCallConfig {
  customCallLimit: number;
  retryDelay: number;
  retryAttemptsLimit: number;
}
export interface GenerateConfig {
  highPriorityTasksLimit: number;
  retryDelay: number;
  retryAttemptsLimit: number;
}

export interface GenerateWithQueueConfig extends GenerateConfig {
  minPollerInterval: number;
  maxPollerInterval: number;
  pollerTimeCoefficient: number;
  /**
   * How many times a task that waited too long for the rate limiter goes back to the incoming queue. After that it
   * goes to the dead-letter queue, or as an error message to the outgoing queue. Default: 10
   */
  maxRequeueAttempts?: number;
}
