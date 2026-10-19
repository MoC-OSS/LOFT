import { Agent, Chat, DI_TYPES, Interface, Logger, Strategy } from '@moc-global/loft-definitions';
import { inject, injectable, optional } from 'inversify';

import { FocusRegistry } from './focus';

@injectable()
export class LOFT<TChatInterface extends Chat.ChatInterface | Chat.ChatInterfaceWithSMG> {
  public readonly log = new Logger('LOFT');

  constructor(
    @inject(DI_TYPES.ChatStrategy) public readonly chat: TChatInterface,
    @inject(DI_TYPES.FocusRegistry) public readonly focusRegistry: FocusRegistry,
    @inject(DI_TYPES.LlmManager) @optional() private readonly llmManager?: Interface.LlmManager,
    @inject(DI_TYPES.TracerStrategy) @optional() private readonly tracerStrategy?: Strategy.Tracer.TracerFactory
  ) {}

  public registerFocus(name: string, config: Agent.Focus): void {
    this.focusRegistry.register(name, config);
  }

  public getFocus(name: string): Agent.Focus | undefined {
    return this.focusRegistry.get(name);
  }

  public async shutdown() {
    this.log.info('LOFT: Received shutdown signal, initiating graceful shutdown...');
    await this.chat.shutdown();
    // After the last operation: stops the rate limiter and queue poller timers of every LLM strategy
    this.llmManager?.stop?.();
    // Then sends the traces that are left
    try {
      await this.tracerStrategy?.shutdownAsync();
    } catch (error) {
      this.log.error('LOFT: Tracer shutdown failed', error);
    }
    this.log.info('LOFT: Graceful shutdown completed');
  }
}
