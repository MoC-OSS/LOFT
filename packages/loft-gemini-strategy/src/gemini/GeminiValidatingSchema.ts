import type { Content, GenerateContentResponse } from '@google/genai';
import { Strategy } from '@moc-global/loft-definitions';
import { z, ZodType } from 'zod';

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
  responseSchema: z.any().optional()
});

export type ModelPreset = z.infer<typeof ModelPresetSchema>;

// Content schema for request validation
const ContentSchema: ZodType<Content> = z
  .object({
    role: z.string().optional(),
    parts: z.array(z.object({ text: z.string().optional() }).passthrough()).optional()
  })
  .passthrough();

// Request schema
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
      candidateCount: z.number().optional()
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
  callContext: z.record(z.any()).optional(),
  priority: z.number().optional()
});
