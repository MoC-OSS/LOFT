import { describe, expect, it } from 'vitest';

import { MessageCreateParamsSchema } from '../../AnthropicValidatingSchemas';

const PRESET = { model: 'claude-sonnet-5-5', max_tokens: 4096 };

describe('MessageCreateParamsSchema', () => {
  it('accepts a preset without temperature, top_p and top_k', () => {
    expect(MessageCreateParamsSchema.safeParse(PRESET).success).toBe(true);
  });

  it.each([
    { type: 'between_tools' },
    { type: 'adaptive' },
    { type: 'adaptive', display: 'omitted' },
    { type: 'disabled' },
    { type: 'enabled', budget_tokens: 2048 },
    { type: 'enabled', budget_tokens: 2048, display: 'summarized' }
  ])('accepts thinking %j', (thinking) => {
    expect(MessageCreateParamsSchema.safeParse({ ...PRESET, thinking }).success).toBe(true);
  });

  it('rejects an enabled thinking config with budget_tokens below 1024', () => {
    const result = MessageCreateParamsSchema.safeParse({
      ...PRESET,
      thinking: { type: 'enabled', budget_tokens: 512 }
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('Minimum budget_tokens is 1024');
  });

  it('rejects an unknown thinking type', () => {
    expect(MessageCreateParamsSchema.safeParse({ ...PRESET, thinking: { type: 'sometimes' } }).success).toBe(false);
  });

  it.each([
    { output_config: { effort: 'low' } },
    { output_config: { format: { type: 'json_schema', schema: { type: 'object' } } } },
    { service_tier: 'standard_only' },
    { inference_geo: 'us' },
    { cache_control: { type: 'ephemeral', ttl: '1h' } },
    { tool_choice: { type: 'none' } },
    { system: [{ type: 'text', text: 'Be brief.', cache_control: { type: 'ephemeral', ttl: '5m' } }] }
  ])('accepts %j', (fields) => {
    expect(MessageCreateParamsSchema.safeParse({ ...PRESET, ...fields }).success).toBe(true);
  });

  it.each([
    { output_config: { effort: 'extreme' } },
    { service_tier: 'priority' },
    { cache_control: { type: 'ephemeral', ttl: '2h' } },
    // Sent as headers by the SDK, so they are not preset fields
    { workspace_id: 'wrkspc_1' },
    { user_profile_id: 'profile-1' }
  ])('rejects %j', (fields) => {
    expect(MessageCreateParamsSchema.safeParse({ ...PRESET, ...fields }).success).toBe(false);
  });
});
