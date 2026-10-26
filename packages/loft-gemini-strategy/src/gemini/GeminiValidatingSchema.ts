import type { Content, GenerateContentResponse } from '@google/genai';
import { Strategy } from '@moc-global/loft-definitions';
import { z, ZodType, ZodTypeAny } from 'zod';

import { GeminiRequest } from '../VertexAiTypes';

// Re-export enums from SDK for type safety
export {
  FinishReason,
  HarmBlockMethod,
  HarmBlockThreshold,
  HarmCategory,
  HarmProbability,
  HarmSeverity
} from '@google/genai';

/**
 * Model preset configuration that matches SDK's GenerateContentConfig
 * This is the most important schema as it validates manifest configs
 */
const ModelPresetSchema = z.object({
  // Required
  model: z.string(),

  // Generation config (camelCase as per new SDK)
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  topK: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  stopSequences: z.array(z.string()).optional(),
  candidateCount: z.number().int().positive().optional(),
  presencePenalty: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  responseLogprobs: z.boolean().optional(),
  logprobs: z.number().int().optional(),

  // Safety settings
  safetySettings: z
    .array(
      z.object({
        category: z.string(),
        threshold: z.string(),
        method: z.string().optional()
      })
    )
    .optional(),

  // System instruction
  systemInstruction: z.union([z.string(), z.object({ parts: z.array(z.any()) }).passthrough()]).optional(),

  // Tool config
  toolConfig: z
    .object({
      functionCallingConfig: z
        .object({
          mode: z.string().optional(),
          allowedFunctionNames: z.array(z.string()).optional()
        })
        .optional()
    })
    .optional(),

  // Response config
  responseMimeType: z.string().optional(),
  /** Gemini's schema format, a subset of OpenAPI 3.0; sent as given */
  responseSchema: z.unknown().optional(),

  // Thinking and sampling
  thinkingConfig: z
    .object({
      thinkingBudget: z.number().int().optional(),
      includeThoughts: z.boolean().optional(),
      thinkingLevel: z.string().optional()
    })
    .optional(),
  seed: z.number().int().optional(),

  // snake_case spellings that older manifests use
  /** Alias of `maxOutputTokens`; the camelCase key wins. */
  max_output_tokens: z.number().int().positive().optional(),
  /** Alias of `topP`; the camelCase key wins. */
  top_p: z.number().min(0).max(1).optional(),
  /** Alias of `topK`; the camelCase key wins. */
  top_k: z.number().int().positive().optional(),
  /** Alias of `stopSequences`; the camelCase key wins. */
  stop_sequences: z.array(z.string()).optional(),
  /** Alias of `candidateCount`; the camelCase key wins. */
  candidate_count: z.number().int().positive().optional()
});

export type ModelPreset = z.infer<typeof ModelPresetSchema>;

// Content schema for request validation
const ContentSchema: ZodType<Content> = z
  .object({
    role: z.string().optional(),
    parts: z.array(z.object({ text: z.string().optional() }).passthrough()).optional()
  })
  .passthrough();

type GeminiConfig = NonNullable<GeminiRequest['config']>;

// A value of an SDK type whose fields are SDK enums, checked against a schema of its shape and kept as given
const sdkValue = <T>(schema: ZodTypeAny) => z.custom<T>((value) => schema.safeParse(value).success);

// Request schema. The config has the keys the strategy builds; any other key, such as the SDK's `httpOptions` (which
// sets the URL and headers of the request), is dropped, so a queued request cannot set it
const GeminiRequestSchema: ZodType<GeminiRequest> = z.object({
  model: z.string(),
  contents: z.array(ContentSchema),
  systemInstruction: ContentSchema.optional(),
  config: z
    .object({
      maxOutputTokens: z.number().optional(),
      temperature: z.number().optional(),
      topP: z.number().optional(),
      topK: z.number().optional(),
      stopSequences: z.array(z.string()).optional(),
      candidateCount: z.number().optional(),
      presencePenalty: z.number().optional(),
      frequencyPenalty: z.number().optional(),
      responseLogprobs: z.boolean().optional(),
      logprobs: z.number().optional(),
      seed: z.number().optional(),
      safetySettings: sdkValue<GeminiConfig['safetySettings']>(
        z.array(z.object({ category: z.string(), threshold: z.string(), method: z.string().optional() }))
      ).optional(),
      toolConfig: sdkValue<GeminiConfig['toolConfig']>(
        z.object({
          functionCallingConfig: z
            .object({ mode: z.string().optional(), allowedFunctionNames: z.array(z.string()).optional() })
            .optional()
        })
      ).optional(),
      // Only the function declarations the strategy builds are kept. Any other tool, such as Google Search, URL
      // context, code execution or retrieval, runs on Google's side, so a queued request cannot turn one on.
      tools: sdkValue<NonNullable<GeminiConfig['tools']>>(
        z.array(z.object({ functionDeclarations: z.array(z.object({ name: z.string() })) }))
      )
        .transform((tools) => tools.map(({ functionDeclarations }) => ({ functionDeclarations })))
        .optional(),
      responseMimeType: z.string().optional(),
      responseSchema: z.unknown().optional(),
      thinkingConfig: sdkValue<GeminiConfig['thinkingConfig']>(
        z.object({
          thinkingBudget: z.number().optional(),
          includeThoughts: z.boolean().optional(),
          thinkingLevel: z.string().optional()
        })
      ).optional()
    })
    .optional()
});

// Response schema - passthrough to accept full SDK response
const GenerateContentResponseSchema: ZodType<GenerateContentResponse> = z.any();

export class GeminiValidatingSchema {
  /**
   * Schema for validating LLM response from Gemini API
   */
  static responseValidationSchema(): ZodType<GenerateContentResponse> {
    return GenerateContentResponseSchema;
  }

  /**
   * Schema for validating model preset configuration in manifests
   * This is the primary validation schema used for config validation
   */
  static modelPresetValidationSchema() {
    return ModelPresetSchema;
  }

  /**
   * Schema for validating full Gemini request
   */
  static generateRequestValidationSchema(): ZodType<GeminiRequest> {
    return GeminiRequestSchema;
  }
}

export const GeminiRequestBodySchema = z.object({
  sessionId: z.string(),
  llmName: z.string(),
  requestType: z.nativeEnum(Strategy.LLM.LLMRequestType),
  llmBody: GeminiValidatingSchema.generateRequestValidationSchema(),
  callContext: z.record(z.string(), z.any()).optional(),
  priority: z.number().optional()
});
