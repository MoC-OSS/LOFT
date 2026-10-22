import { ExponentialBackoffPoller, Logger, Strategy } from '@moc-global/loft-definitions';

import { LlmCallManagerLongAwaitError } from './errors';
import { GenerateCallManager } from './GenerateManager';
import { GenerateWithQueueConfig } from './types';

const log = new Logger('LlmCallManager');

const DEFAULT_MAX_REQUEUE_ATTEMPTS = 10;

export class GenerateWithQueueManager<T_LLM_Req, T_LLM_Res> extends GenerateCallManager<T_LLM_Req, T_LLM_Res> {
  private readonly poller: ExponentialBackoffPoller;

  constructor(
    name: string,
    private configWithQueue: GenerateWithQueueConfig,
    llm: Strategy.LLM.LLMApi,
    private readonly incomingLoftQueue: Strategy.LoftQueue,
    private readonly outgoingLoftQueue: Strategy.LoftQueue,
    /** Gets a task, with its error, once it was requeued `maxRequeueAttempts` times */
    private readonly deadLetterLoftQueue?: Strategy.LoftQueue
  ) {
    super(
      name,
      {
        highPriorityTasksLimit: configWithQueue.highPriorityTasksLimit,
        retryDelay: configWithQueue.retryDelay,
        retryAttemptsLimit: configWithQueue.retryAttemptsLimit,
        concurrency: configWithQueue.concurrency,
        reserveTokens: configWithQueue.reserveTokens,
        streamIdleTimeoutMs: configWithQueue.streamIdleTimeoutMs,
        streamFirstEventTimeoutMs: configWithQueue.streamFirstEventTimeoutMs
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
        await this.requeue(validatingResult.data, rawTaskData?.requeueAttempts, error);
      }
      log.error('Happen error when try to call low priority call to llm:', error);
      throw error;
    }

    // Only enqueues the next task. Awaiting that task here could deadlock: this handler holds a queue slot, the only
    // one at the default concurrency of 1.
    void this.checkTaskQueue();
  }

  // Puts a task that waited too long back in the incoming queue, counting the attempts, until the limit
  private async requeue(task: Record<string, any>, previousAttempts: unknown, error: Error) {
    const requeueAttempts = (typeof previousAttempts === 'number' ? previousAttempts : 0) + 1;
    const maxRequeueAttempts = this.configWithQueue.maxRequeueAttempts ?? DEFAULT_MAX_REQUEUE_ATTEMPTS;
    if (requeueAttempts <= maxRequeueAttempts) {
      await this.incomingLoftQueue.publish(JSON.stringify({ ...task, requeueAttempts }));
      return;
    }

    log.error(`Task of session ${task.sessionId} gave up after ${maxRequeueAttempts} requeues`);
    const failure = { name: error.name, message: error.message };
    if (this.deadLetterLoftQueue) {
      await this.deadLetterLoftQueue.publish(
        JSON.stringify({ ...task, requeueAttempts: maxRequeueAttempts, error: failure })
      );
      return;
    }
    // Without a dead-letter queue, whoever waits for the result learns that the task failed
    await this.outgoingLoftQueue.publish(
      JSON.stringify({
        sessionId: task.sessionId,
        llmName: task.llmName,
        callContext: task.callContext,
        priority: 0,
        error: failure
      })
    );
  }
}
