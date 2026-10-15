import type {
  Content,
  FunctionCallingConfigMode,
  FunctionDeclaration,
  GenerateContentResponse,
  Part
} from '@google/genai';

export { Content, FunctionDeclaration, GenerateContentResponse, Part };

/**
 * Request type for Gemini API
 */
export type GeminiRequest = {
  model: string;
  contents: Content[];
  systemInstruction?: Content;
  config?: {
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
    candidateCount?: number;
    tools?: Array<{ functionDeclarations: FunctionDeclaration[] }>;
    toolConfig?: {
      functionCallingConfig?: {
        mode?: FunctionCallingConfigMode;
        allowedFunctionNames?: string[];
      };
    };
  };
};

/**
 * Response type from Gemini API
 */
export type GeminiResponse = GenerateContentResponse;

/**
 * Stream chunk type from Gemini API
 */
export type GeminiStreamChunk = GenerateContentResponse;
