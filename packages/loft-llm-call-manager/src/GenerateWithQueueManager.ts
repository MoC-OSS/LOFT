import { ExponentialBackoffPoller, Logger, Strategy } from '@moc-global/loft-definitions';

import { LlmCallManagerLongAwaitError } from './errors';
import { GenerateCallManager } from './GenerateManager';
import { GenerateWithQueueConfig } from './types';

const log = new Logger('LlmCallManager');

export class GenerateWithQueueManager<T_LLM_Req, T_LLM_Res> extends GenerateCallManager<T_LLM_Req, T_LLM_Res> {
  private readonly poller: ExponentialBackoffPoller;

  constructor(
    name: string,
    private configWithQueue: GenerateWithQueueConfig,
    llm: Strategy.LLM.LLMApi,
    private readonly incomingLoftQueue: Strategy.LoftQueue,
    private readonly outgoingLoftQueue: Strategy.LoftQueue
  ) {
    super(
      name,
      {
        highPriorityTasksLimit: configWithQueue.highPriorityTasksLimit,
        retryDelay: configWithQueue.retryDelay,
        retryAttemptsLimit: configWithQueue.retryAttemptsLimit
      },
      llm
    );

    this.poller = new ExponentialBackoffPoller(
      {
        minTime: this.configWithQueue.minPollerInterval,
        maxTime: this.configWithQueue.maxPollerInterval,
        timeCoefficient: this.configWithQueue.pollerTimeCoefficient
      },
      this.checkTaskQueue.bind(this)
    );
    this.poller.start();
  }

  stop() {
    this.poller.stop();
    super.stop();
  }

  private async checkTaskQueue() {
    if (this.taskPQueue.sizeBy({ priority: 0 }) === 0) {
      // Nothing awaits this task, so a rejection would be unhandled and crash the process
      this.taskPQueue
        .add(this.lowPriorityTaskQueueHandler.bind(this), {
          priority: 0
        })
        .catch((error) => log.error('Low priority task failed:', error));
    }
  }

  private async lowPriorityTaskQueueHandler() {
    const lowPriorityTask = await this.incomingLoftQueue.consume();
    if (!lowPriorityTask) return; // queue is empty

    let rawTaskData;
    try {
      rawTaskData = JSON.parse(lowPriorityTask);
    } catch (error) {
      log.error('Failed to parse lowPriorityTask JSON:', error);
      throw error;
    }

    const validatingSchema = this.llmStrategy.generateRequestValidationSchema();

    const validatingResult = validatingSchema.safeParse(rawTaskData);

    if (validatingResult.success === false) {
      log.error('lowPriority task data is not valid:', validatingResult.error);
      throw validatingResult.error;
    }
    try {
      const result = await this.taskPQueueHandler(validatingResult.data.llmBody);
      await this.outgoingLoftQueue.publish(
        JSON.stringify({
          sessionId: validatingResult.data.sessionId,
          llmName: validatingResult.data.llmName,
          llmBody: result,
          callContext: validatingResult.data.callContext,
          priority: 0
        })
      );
    } catch (error) {
      if (error instanceof LlmCallManagerLongAwaitError) {
        await this.incomingLoftQueue.publish(JSON.stringify(validatingResult.data));
      }
      log.error('Happen error when try to call low priority call to llm:', error);
      throw error;
    }

    // Only enqueues the next task. Awaiting that task here would deadlock: this handler holds the queue's only slot.
    void this.checkTaskQueue();
  }
}
