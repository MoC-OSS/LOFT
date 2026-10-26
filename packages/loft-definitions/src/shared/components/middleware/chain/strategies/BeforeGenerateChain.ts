import { InteractiveOutputMessage, Strategy } from '../../../../..';
import { Type } from '../../../../..';
import { ContextInterface } from '../../Context';
import { OverrideGeneratePayload } from '../ChainInterfaces';
import { BeforeGenerateChainResult } from '../ChainInterfaces';
import { BeforeGenerateChainStrategy } from '../ChainInterfaces';
import { AbstractChain } from './AbstractChain';

export class BeforeGenerateChain<TContext, TPayload>
  extends AbstractChain<TContext, TPayload, BeforeGenerateChainResult<TPayload>>
  implements BeforeGenerateChainStrategy<TContext, TPayload>
{
  private _generationPrevented: boolean = false;
  private _overrideGeneratePayload: OverrideGeneratePayload | null = null;

  preventGeneration(overrideGeneratePayload: OverrideGeneratePayload) {
    this._generationPrevented = true;
    this._overrideGeneratePayload = overrideGeneratePayload;
  }

  get overrideGenerateResponse(): OverrideGeneratePayload | null {
    return this._overrideGeneratePayload;
  }

  get isGenerationPrevented(): boolean {
    return this._generationPrevented;
  }

  getResult(payload: TPayload): BeforeGenerateChainResult<TPayload> {
    let generatedResponse = null;

    if (this._generationPrevented && this._overrideGeneratePayload) {
      const ctx = this._ctx as unknown as ContextInterface;
      // Get the temporary request configuration if it exists in the payload
      const temporaryRequestConfig = (payload as any)?.temporaryRequestConfig || {};

      const {
        content,
        role = Type.LLM.UnifiedMessageRole.assistant,
        llmName = temporaryRequestConfig.llmName || ctx.session?.currentLlmName,
        manifestName = temporaryRequestConfig.manifestName || ctx.session?.currentManifestName
      } = this._overrideGeneratePayload;

      const overrideMessage = new InteractiveOutputMessage({
        content,
        role,
        author: 'middleware_manager',
        llmName,
        manifestName,
        sessionId: ctx.session?.id || '',
        ctx: {},
        llmIgnore: false
      });

      generatedResponse = {
        choices: [overrideMessage],
        topChoice: overrideMessage,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          model: 'override',
          finishReason: Strategy.LLM.LoftFinishReason.MIDDLEWARE_OVERRIDE
        },
        originalResponse: undefined
      };
    }

    if (this._generationPrevented) {
      return {
        payload,
        isGenerationPrevented: true,
        overrideGenerateResponse: generatedResponse as Strategy.LLM.UnifiedLLMResponse
      };
    } else {
      return {
        payload,
        isGenerationPrevented: false,
        overrideGenerateResponse: null
      };
    }
  }
}
