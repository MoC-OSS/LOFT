/**
 * Configuration for Vertex AI mode (GCP credentials)
 */
export type VertexAiModeConfig = {
  mode: 'vertexai';
  /** GCP project ID */
  project: string;
  /** GCP region (default: 'us-central1') */
  location?: string;
};

/**
 * Configuration for API Key mode (Google AI Studio)
 */
export type ApiKeyModeConfig = {
  mode: 'apikey';
  /** API key from Google AI Studio */
  apiKey: string;
};

/**
 * Unified configuration for Gemini strategy
 * Supports both Vertex AI (GCP) and API Key (Google AI Studio) modes
 */
export type GeminiStrategyConfig = VertexAiModeConfig | ApiKeyModeConfig;

/**
 * @deprecated Use GeminiStrategyConfig instead
 */
export type VertexAiCallStrategyConfig = GeminiStrategyConfig;
