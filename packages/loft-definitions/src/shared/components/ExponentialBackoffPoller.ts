export type PollingConfig = {
  minTime: number;
  maxTime: number;
  timeCoefficient?: number;
};

export class ExponentialBackoffPoller {
  private currentInterval: number;
  private timeCoefficient: number;
  private pollFunction: () => Promise<any>;
  private timer?: NodeJS.Timeout;
  private stopped = false;

  /**
   *
   * @param minTime
   * @param maxTime
   * @param pollFunction async function that must throw an error if the request hasn't data to return or if the request fails
   * @param timeCoefficient default 1.5 (the interval time will be multiplied by this value on failure)
   */
  constructor(
    private readonly config: PollingConfig,
    pollFunction: () => Promise<any>
  ) {
    const { minTime, maxTime, timeCoefficient } = config;
    if (minTime <= 0 || maxTime <= 0 || minTime >= maxTime) {
      throw new Error('Invalid minTime or maxTime values');
    }

    this.currentInterval = minTime;
    this.timeCoefficient = timeCoefficient || 1.5;
    this.pollFunction = pollFunction;
  }

  start() {
    this.stopped = false;
    // handlePolling catches every error and schedules the next poll itself
    void this.handlePolling();
  }

  /** Stops polling. A poll that is running finishes, but no further poll is scheduled. */
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private async handlePolling(): Promise<void> {
    try {
      const result = await this.pollFunction();
      if (result === false) throw new Error('No data found. pollFunction() will be called again.');

      this.currentInterval = this.config.minTime;
    } catch {
      // Not logged: pollFunction throws to signal "no data", so this is the normal idle path.
      // A pollFunction that can fail must log its own errors. Back off exponentially, up to the maximum.
      this.currentInterval = Math.min(this.currentInterval * this.timeCoefficient, this.config.maxTime);
    } finally {
      if (!this.stopped) {
        // Not unref'd: the poller is the work loop of a queue worker and keeps the process alive until stop()
        this.timer = setTimeout(() => this.handlePolling(), this.currentInterval);
      }
    }
  }
}
