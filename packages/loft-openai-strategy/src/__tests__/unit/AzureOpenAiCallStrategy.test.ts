import { Strategy } from '@moc-global/loft-definitions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AzureOpenAiCallStrategy, AzureOpenAiConfig } from '../../AzureOpenAiCallStrategy';

const ENDPOINT = 'https://contoso.openai.azure.com';

const createClient = (config: Omit<AzureOpenAiConfig, 'auth'>) =>
  new AzureOpenAiCallStrategy(
    { ...config, auth: { type: 'api-key', apiKey: 'test-key' } },
    {} as Strategy.LLM.LlmTokenRateLimiter,
    {} as Strategy.LLM.LlmTokenizer
  )['client'];

describe('AzureOpenAiCallStrategy', () => {
  beforeEach(() => {
    // The OpenAI SDK reads these; clear them so the developer's shell cannot change the outcome
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', '');
    vi.stubEnv('OPENAI_BASE_URL', '');
    vi.stubEnv('OPENAI_API_VERSION', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('endpoint', () => {
    it('sends requests to the configured endpoint', () => {
      expect(createClient({ endpoint: ENDPOINT }).baseURL).toBe(`${ENDPOINT}/openai`);
    });

    it('falls back to AZURE_OPENAI_ENDPOINT when no endpoint is configured', () => {
      vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://from-env.openai.azure.com');

      expect(createClient({}).baseURL).toBe('https://from-env.openai.azure.com/openai');
    });

    it('throws when neither the config nor the environment sets an endpoint', () => {
      expect(() => createClient({})).toThrow(/endpoint/);
    });
  });

  describe('auth', () => {
    it('builds the client with a Microsoft Entra ID token provider for azure-ad', () => {
      const client = new AzureOpenAiCallStrategy(
        { endpoint: ENDPOINT, deploymentName: 'prod-chat', auth: { type: 'azure-ad' } },
        {} as Strategy.LLM.LlmTokenRateLimiter,
        {} as Strategy.LLM.LlmTokenizer
      )['client'];

      expect(client.baseURL).toBe(`${ENDPOINT}/openai`);
      expect(client.deploymentName).toBe('prod-chat');
    });

    it('builds the client with the API key for api-key', () => {
      const client = createClient({ endpoint: ENDPOINT });

      expect(client.apiKey).toBe('test-key');
    });
  });

  describe('deploymentName', () => {
    // buildRequest is async in openai 7 and sync in openai 4; awaiting works with both
    const chatCompletionPath = async (config: Omit<AzureOpenAiConfig, 'auth'>) => {
      const { url } = await createClient(config).buildRequest({
        method: 'post',
        path: '/chat/completions',
        body: { model: 'gpt-4o', messages: [] }
      });
      return new URL(url).pathname;
    };

    it('sends requests to the configured deployment, whatever the model', async () => {
      expect(await chatCompletionPath({ endpoint: ENDPOINT, deploymentName: 'prod-chat' })).toBe(
        '/openai/deployments/prod-chat/chat/completions'
      );
    });

    it('uses the model as the deployment when none is configured', async () => {
      expect(await chatCompletionPath({ endpoint: ENDPOINT })).toBe('/openai/deployments/gpt-4o/chat/completions');
    });
  });

  describe('apiVersion', () => {
    it.each([
      { name: 'the configured version', config: { apiVersion: '2025-04-01-preview' }, expected: '2025-04-01-preview' },
      {
        name: 'the configured version even with a deployment',
        config: { apiVersion: '2025-04-01-preview', deploymentName: 'gpt-4o' },
        expected: '2025-04-01-preview'
      },
      {
        name: 'the preview default with a deployment',
        config: { deploymentName: 'gpt-4o' },
        expected: '2024-10-01-preview'
      },
      { name: 'the GA default otherwise', config: {}, expected: '2024-10-21' }
    ])('uses $name', ({ config, expected }) => {
      expect(createClient({ endpoint: ENDPOINT, ...config }).apiVersion).toBe(expected);
    });
  });

  describe('generate', () => {
    it('passes the signal to chat.completions.create', async () => {
      const { signal } = new AbortController();
      const create = vi.fn().mockResolvedValue({ id: 'chatcmpl-1' });
      const strategy = new AzureOpenAiCallStrategy(
        { endpoint: ENDPOINT, deploymentName: 'd', auth: { type: 'api-key', apiKey: 'test-key' } },
        {} as Strategy.LLM.LlmTokenRateLimiter,
        {} as Strategy.LLM.LlmTokenizer
      );
      (strategy as unknown as { client: unknown }).client = { chat: { completions: { create } } };
      const request = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] };

      await expect(strategy.generate(request, { signal })).resolves.toEqual({ id: 'chatcmpl-1' });

      expect(create).toHaveBeenCalledWith(request, { signal });
    });
  });
});
