import { Strategy } from '@moc-global/loft-definitions';
import { describe, expect, it } from 'vitest';

import { GeminiLoftStrategy } from '../../gemini/GeminiLoftStrategy';
import { GeminiValidatingSchema } from '../../gemini/GeminiValidatingSchema';

const strategy = new GeminiLoftStrategy({ llmName: 'gemini' }, {} as Strategy.CallManager);

// The request config for a manifest preset, after the preset schema parses it as the manifest manager does
const configFor = async (preset: Record<string, unknown>) => {
  const modelPreset = GeminiValidatingSchema.modelPresetValidationSchema().parse(preset);
  const request = await strategy.formatToLLMRequest([], 'Be brief', modelPreset, []);
  return request.config;
};

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: { answer: { type: 'STRING' } },
  required: ['answer']
};

describe('GeminiLoftStrategy request config', () => {
  it('sends every generation setting of the preset, by its camelCase key', async () => {
    const preset = {
      model: 'gemini-test',
      maxOutputTokens: 64,
      temperature: 0.2,
      topP: 0.9,
      topK: 20,
      stopSequences: ['END'],
      candidateCount: 1,
      presencePenalty: 0.5,
      frequencyPenalty: 0.25,
      responseLogprobs: true,
      logprobs: 3,
      safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' }],
      toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['get_weather'] } },
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0, includeThoughts: false, thinkingLevel: 'LOW' },
      seed: 7
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
    const { model, ...settings } = preset;
    expect(await configFor(preset)).toEqual(settings);
  });

  it('reads the snake_case aliases that older manifests use', async () => {
    expect(
      await configFor({
        model: 'gemini-test',
        max_output_tokens: 64,
        top_p: 0.9,
        top_k: 20,
        stop_sequences: ['END'],
        candidate_count: 2
      })
    ).toEqual({ maxOutputTokens: 64, topP: 0.9, topK: 20, stopSequences: ['END'], candidateCount: 2 });
  });

  it('takes the camelCase key when the preset has both spellings', async () => {
    expect(
      await configFor({
        model: 'gemini-test',
        maxOutputTokens: 64,
        max_output_tokens: 1000,
        topP: 0.5,
        top_p: 0.9,
        top_k: 20
      })
    ).toEqual({ maxOutputTokens: 64, topP: 0.5, topK: 20 });
  });

  it('leaves out the settings the preset does not have', async () => {
    expect(await configFor({ model: 'gemini-test' })).toEqual({});
  });

  it('sends a structured output schema with its MIME type', async () => {
    const config = await configFor({
      model: 'gemini-test',
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA
    });

    expect(config).toEqual({ responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA });
  });
});

describe('Gemini request validation schema', () => {
  const schema = GeminiValidatingSchema.generateRequestValidationSchema();
  const requestWith = (config: Record<string, unknown>) => ({ model: 'gemini-test', contents: [], config });

  it('keeps every key of the request config the strategy builds', () => {
    const config = {
      maxOutputTokens: 64,
      temperature: 0.2,
      topP: 0.9,
      topK: 20,
      stopSequences: ['END'],
      candidateCount: 1,
      presencePenalty: 0.5,
      frequencyPenalty: 0.25,
      responseLogprobs: true,
      logprobs: 3,
      seed: 7,
      safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      tools: [{ functionDeclarations: [{ name: 'ping', description: '' }] }],
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0, includeThoughts: true }
    };

    expect(schema.parse(requestWith(config)).config).toEqual(config);
  });

  it('drops any other key, such as the SDK httpOptions that set the URL and headers of the request', () => {
    const config = {
      maxOutputTokens: 64,
      httpOptions: { baseUrl: 'https://example.com', headers: { 'x-test': '1' } },
      abortSignal: 'not a signal',
      unknownKey: true
    };

    expect(schema.parse(requestWith(config)).config).toEqual({ maxOutputTokens: 64 });
  });

  it('keeps only the function declarations of the tools, never a tool that runs on the server', () => {
    const functionDeclarations = [{ name: 'ping', description: '' }];
    const config = {
      tools: [
        { functionDeclarations, googleSearch: {}, urlContext: {} },
        { functionDeclarations: [], codeExecution: {}, retrieval: { vertexAiSearch: { datastore: 'store' } } }
      ]
    };

    expect(schema.parse(requestWith(config)).config).toEqual({
      tools: [{ functionDeclarations }, { functionDeclarations: [] }]
    });
  });

  it('rejects a declared key of the wrong type', () => {
    expect(schema.safeParse(requestWith({ temperature: 'hot' })).success).toBe(false);
    expect(schema.safeParse(requestWith({ safetySettings: [{ category: 1 }] })).success).toBe(false);
    expect(schema.safeParse(requestWith({ tools: [{ functionDeclarations: [{}] }] })).success).toBe(false);
  });
});
