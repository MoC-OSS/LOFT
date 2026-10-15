import { createContextProxyWithOverrides, Interface, Logger, Strategy, Type } from '@moc-global/loft-definitions';
import { injectable } from 'inversify';

@injectable()
export class ComputerManager<
  PromptContext extends Record<string, any>
> implements Interface.ComputerManager<PromptContext> {
  private handlers: Map<string, Interface.PromptComputer<PromptContext>> = new Map();
  private readonly log: Interface.Logger;

  constructor(private readonly computerType: string) {
    this.log = new Logger(`ComputerManager:${computerType}`);
  }

  public use(manifestName: string, llmName: string, handler: Interface.PromptComputer<PromptContext>) {
    const combinedName = this.getCombinedName(manifestName, llmName);
    this.log.trace(`Registering System Message Handler: ${combinedName}`);
    if (this.handlers.has(combinedName)) {
      throw new Error(`A System Message Handler with the name "${combinedName}" already exists.`);
    }
    this.handlers.set(combinedName, handler);
  }

  private getCombinedName(name: string, llmName: string): string {
    return `${name}-${llmName}`;
  }

  private getHandler(manifestName: string, llmName: string): Interface.PromptComputer<PromptContext> | undefined {
    const combinedName = this.getCombinedName(manifestName, llmName);
    const handler = this.handlers.get(combinedName);
    if (handler !== undefined) return handler;
  }

  public async compute(
    promptCtx: PromptContext,
    systemMessage: Type.LLMManifestProps['systemMessage'],
    name: string,
    llmName: string,
    modelPreset?: Type.LLMManifestProps['modelPreset']
  ): Promise<string> {
    this.log.trace(`Computing Prompt: ${name}, LLM Name: ${llmName}`);
    const handler = this.getHandler(name, llmName);
    if (!handler) return systemMessage;

    const tracer = (promptCtx as any).tracer as Strategy.Tracer.Tracer;

    // Create span for this computer with type
    const computerSpan = tracer.span({
      name: `computer/${this.computerType}/${name}`,
      input: { systemMessage, llmName, modelPreset },
      metadata: {
        computerName: name,
        computerType: this.computerType,
        llmName
      }
    });

    try {
      // Create wrapped tracer with this span as parent
      const wrappedTracer = tracer.withParent(computerSpan.id);

      // Create proxy context with overridden tracer
      const contextForHandler = createContextProxyWithOverrides(promptCtx, {
        tracer: wrappedTracer
      } as any);

      this.log.trace(`Computer span created`, {
        name,
        spanId: computerSpan.id,
        computerType: this.computerType
      });

      const prompt: Interface.Prompt = {
        name: name,
        content: systemMessage
      };

      // Execute handler with proxied context
      const computed = await handler(contextForHandler, prompt, { ...modelPreset });

      // End span with success
      computerSpan.end({
        output: computed,
        level: 'DEFAULT'
      });

      return computed;
    } catch (error) {
      // End span with error
      computerSpan.end({
        level: 'ERROR',
        statusMessage: error instanceof Error ? error.message : String(error)
      });

      this.log.error(`Error in computer handler ${name}`, error);
      throw error;
    }
  }
}
