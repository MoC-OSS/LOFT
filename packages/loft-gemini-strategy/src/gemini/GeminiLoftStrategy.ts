import { Interface, Logger, Strategy, Type } from '@moc-global/loft-definitions';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodSchema } from 'zod';

import { Content, GeminiRequest, GeminiResponse } from '../VertexAiTypes';
import { organizeMessagesForGemini } from './adapters/messageRequest';
import { formatGeminiResponseToUnified } from './adapters/messageResponse';
import { createGeminiToolsConfig } from './adapters/toolDeclaration';
import { GeminiStream } from './GeminiStream';
import { GeminiValidatingSchema } from './GeminiValidatingSchema';

type GeminiConfig = NonNullable<GeminiRequest['config']>;

// The preset keys sent in the request config, each with the snake_case alias older manifests use, if it has one
const PRESET_CONFIG_KEYS: ReadonlyArray<readonly [keyof GeminiConfig, string?]> = [
  ['maxOutputTokens', 'max_output_tokens'],
  ['temperature'],
  ['topP', 'top_p'],
  ['topK', 'top_k'],
  ['stopSequences', 'stop_sequences'],
  ['candidateCount', 'candidate_count'],
  ['presencePenalty'],
  ['frequencyPenalty'],
  ['responseLogprobs'],
  ['logprobs'],
  ['safetySettings'],
  ['toolConfig'],
  ['responseMimeType'],
  ['responseSchema'],
  ['thinkingConfig'],
  ['seed']
];

/**
 * The generation settings of a model preset as the request config; the camelCase key wins over its alias, and a key
 * the preset leaves out is not sent
 */
function presetToConfig(modelPreset: Type.LLMManifestProps['modelPreset']): GeminiConfig {
  const config: Record<string, unknown> = {};
  for (const [key, alias] of PRESET_CONFIG_KEYS) {
    const value = modelPreset[key] ?? (alias ? modelPreset[alias] : undefined);
    if (value !== undefined) config[key] = value;
  }
  return config as GeminiConfig;
}

export class GeminiLoftStrategy extends Strategy.LLM.AbstractLoftLLM<GeminiRequest, GeminiResponse> {
  public readonly llmName: string;
  protected readonly log = new Logger('LLMStrategy:Gemini');

  constructor({ llmName, loftQueue }: Interface.StrategyArgsFacade, callManagerStrategy: Strategy.CallManager) {
    super(callManagerStrategy, loftQueue);
    this.llmName = llmName;
  }

  async formatToLLMRequest(
    _correlatorIds: string[],
    computedSystemMessage: string,
    modelPreset: Type.LLMManifestProps['modelPreset'],
    messages: Type.Entity.Message[],
    mcpTools?: ListToolsResult['tools']
  ): Promise<GeminiRequest> {
    const filteredMessages = messages.filter((msg) => this.shouldIncludeMessage(msg));
    const contents: Content[] = organizeMessagesForGemini(filteredMessages);

    // Get tools config if MCP tools are provided
    const toolsConfig = mcpTools ? createGeminiToolsConfig(mcpTools) : {};

    const llmRequestBody: GeminiRequest = {
      model: modelPreset.model as string,
      contents,
      systemInstruction: {
        role: 'user',
        parts: [{ text: computedSystemMessage }]
      },
      config: {
        ...presetToConfig(modelPreset),
        ...toolsConfig
      }
    };

    return llmRequestBody;
  }

  formatToUnifiedLLMResponse(
    correlatorIds: string[],
    sessionId: string,
    originalResponse: GeminiResponse,
    llmName: string,
    manifestName: string
  ): Strategy.LLM.UnifiedLLMResponse {
    return formatGeminiResponseToUnified(originalResponse, {
      correlatorIds,
      sessionId,
      llmName,
      manifestName
    });
  }

  /**
   * @deprecated Use chat.generate({ onEvent }) instead.
   * Removed in the next major release.
   */
  async generateStream(llmRequest: Strategy.LLM.LLMRequest<GeminiRequest>): Promise<GeminiStream> {
    if (!this.callManagerStrategy) throw new Error('CallManagerStrategy is not defined');
    const res = await this.callManagerStrategy.streamCall(llmRequest);
    const geminiStream = new GeminiStream();
    res.pipe(geminiStream);
    return geminiStream;
  }

  generateModelPresetSchema(): ZodSchema<unknown> {
    return GeminiValidatingSchema.modelPresetValidationSchema();
  }

  generateResponseSchema(): ZodSchema<unknown> {
    return GeminiValidatingSchema.responseValidationSchema();
  }
}
