import { Chat, ContextInterface, DI_TYPES, Interface, Logger, Strategy } from '@moc-global/loft-definitions';
import { Container } from 'inversify';

import { NoOpTracerStrategy } from '../base-components';
import { FocusRegistry } from '../focus';
import { LOFT } from '../LOFT';
import { LlmManager } from '../managers';
import { LoftConfig } from '../types';

const log = new Logger('LoftConstructor');

type ClassConstructor<T> = new (...args: any[]) => T;

// type for chat constructor
type ChatConstructorType<T extends Chat.ChatInterface | Chat.ChatInterfaceWithSMG> = T extends Chat.ChatInterfaceWithSMG
  ? Interface.ChatConstructorWithSMG
  : Interface.ChatConstructor;

export class LoftConstructor<
  TChatInterface extends Chat.ChatInterface | Chat.ChatInterfaceWithSMG,
  TLoft extends LOFT<TChatInterface> = LOFT<TChatInterface>
> {
  private readonly loftContainer: Container;

  constructor(
    loftConfig: LoftConfig,
    manifestManagerConstructor: Interface.BaseModuleConstructor<Interface.ManifestManager>,
    chatConstructor?: ChatConstructorType<TChatInterface>,
    tracerStrategy?: Strategy.Tracer.TracerFactory,
    logStrategy?: Interface.LoggerStrategy
  ) {
    this.loftContainer = new Container();
    this.bindLoftDependencies(loftConfig, logStrategy, tracerStrategy);
    this.initializeConstructors(manifestManagerConstructor, chatConstructor);
  }

  private initializeConstructors(
    manifestManagerConstructor: Interface.BaseModuleConstructor<Interface.ManifestManager>,
    chatConstructor?: ChatConstructorType<TChatInterface>
  ) {
    const manifestManagerModule = manifestManagerConstructor.getModule(this.loftContainer);
    this.loftContainer.load(manifestManagerModule);

    if (chatConstructor) {
      chatConstructor.initializeContainer(this.loftContainer);
      const chat = chatConstructor.getInstance();
      this.loftContainer.bind<TChatInterface>(DI_TYPES.ChatStrategy).toConstantValue(chat as TChatInterface);
    }
  }

  private bindLoftDependencies(
    loftConfig: LoftConfig,
    logStrategy?: Interface.LoggerStrategy,
    tracerStrategy?: Strategy.Tracer.TracerFactory
  ) {
    // Configure global logger (uses defaults if not provided)
    Logger.configure({
      logLevel: loftConfig.logLevel,
      loggerStrategy: logStrategy
    });

    this.loftContainer.bind<TLoft>(DI_TYPES.LOFT).to(LOFT as ClassConstructor<TLoft>);
    this.loftContainer.bind<Interface.LlmManager>(DI_TYPES.LlmManager).to(LlmManager).inSingletonScope();
    this.loftContainer.bind<FocusRegistry>(DI_TYPES.FocusRegistry).toConstantValue(new FocusRegistry());

    // Bind tracer strategy (default to NoOp if not provided)
    this.loftContainer
      .bind<Strategy.Tracer.TracerFactory>(DI_TYPES.TracerStrategy)
      .toConstantValue(tracerStrategy || new NoOpTracerStrategy());
  }

  public async registerLlmStrategy<T_LLM_Req, T_LLM_Res>(
    llmName: string,
    llmStrategy: Strategy.LLM.LoftLLM<T_LLM_Req, T_LLM_Res>,
    forceOverwrite = false
  ): Promise<void> {
    const llmManager = this.loftContainer.get<Interface.LlmManager>(DI_TYPES.LlmManager);
    await llmManager.use(llmName, llmStrategy, forceOverwrite);
  }

  // Generate Manifest Computer Handler
  public registerGMComputer(
    manifestName: string,
    llmName: string,
    handler: Interface.PromptComputer<ContextInterface>
  ) {
    const computerManager = this.loftContainer.get<Interface.ComputerManager<ContextInterface>>(
      DI_TYPES.GMComputerManager
    );
    computerManager.use(manifestName, llmName, handler);
  }
  // Ai Task Manifest Computer Handler
  public registerATMComputer(
    manifestName: string,
    llmName: string,
    handler: Interface.PromptComputer<ContextInterface>
  ) {
    const computerManager = this.loftContainer.get<Interface.ComputerManager<ContextInterface>>(
      DI_TYPES.ATMComputerManager
    );
    computerManager.use(manifestName, llmName, handler);
  }
  public registerPromptComputer(
    promptName: string,
    llmName: string,
    handler: Interface.PromptComputer<ContextInterface>
  ) {
    const computerManager = this.loftContainer.get<Interface.ComputerManager<ContextInterface>>(
      DI_TYPES.PromptComputerManager
    );
    computerManager.use(promptName, llmName, handler);
  }

  /** Loads and validates the manifests; the returned promise rejects when they are invalid. */
  public validateManifest(): Promise<void> {
    const manifestManager = this.loftContainer.get<Interface.ManifestManager>(DI_TYPES.ManifestManager);
    return manifestManager.updateCache();
  }

  public getInstance(): TLoft {
    return this.loftContainer.get<TLoft>(DI_TYPES.LOFT);
  }

  public async gracefulShutdown(): Promise<void> {
    try {
      // Get tracer strategy from DI container and shutdown
      const tracerStrategy = this.loftContainer.get(DI_TYPES.TracerStrategy) as any;

      if (tracerStrategy && typeof tracerStrategy.shutdownAsync === 'function') {
        await tracerStrategy.shutdownAsync();
      }

      // Other shutdown logic can be added here
    } catch (error) {
      log.error('gracefulShutdown failed', error);
    }
  }
}
