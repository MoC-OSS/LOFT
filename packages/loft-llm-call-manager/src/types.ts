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
}
