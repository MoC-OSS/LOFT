import { Agent } from '@moc-global/loft-definitions';
import { beforeEach, describe, expect, it } from 'vitest';

import { handleConfirmFocus } from '../../../focus/ConfirmTool';
import { InMemoryFocusStateStore } from '../../../focus/InMemoryStateStore';
import { generateFocusTools } from '../../../focus/ToolGenerator';
import { handleUpdateFocus } from '../../../focus/UpdateTool';

const testFocus: Agent.Focus = {
  agentName: 'intake',
  prompt: 'Collect vehicle info',
  fields: [
    { key: 'vehicleType', type: Agent.FocusFieldType.STRING, required: true, description: 'Vehicle type' },
    { key: 'year', type: Agent.FocusFieldType.NUMBER, required: true, description: 'Model year' },
    {
      key: 'coverage',
      type: Agent.FocusFieldType.ENUM,
      required: true,
      description: 'Coverage level',
      values: ['basic', 'full']
    },
    {
      key: 'year_valid',
      type: Agent.FocusFieldType.NUMBER,
      required: false,
      description: 'Validated year',
      validate: (v) => (v as number) >= 2000 || 'Year must be >= 2000'
    }
  ],
  onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'validator' }
};

describe('UpdateFocusTool', () => {
  let store: InMemoryFocusStateStore;

  beforeEach(() => {
    store = new InMemoryFocusStateStore();
  });

  it('should accept a valid string field', async () => {
    const result = await handleUpdateFocus({ vehicleType: 'car' }, testFocus, store, 'sess-1');
    expect(result.content[0].text).toContain('Accepted: vehicleType');
    expect(await store.get('sess-1', 'intake', 'vehicleType')).toBe('car');
  });

  it('should coerce string to number', async () => {
    const result = await handleUpdateFocus({ year: '2020' }, testFocus, store, 'sess-1');
    expect(result.content[0].text).toContain('Accepted: year');
    expect(await store.get('sess-1', 'intake', 'year')).toBe(2020);
  });

  it('should reject invalid enum value', async () => {
    const result = await handleUpdateFocus({ coverage: 'premium' }, testFocus, store, 'sess-1');
    expect(result.content[0].text).toContain('Rejected coverage');
    expect(result.isError).toBe(true);
    expect(await store.get('sess-1', 'intake', 'coverage')).toBeUndefined();
  });

  it('should reject unknown field', async () => {
    const result = await handleUpdateFocus({ unknown_field: 'value' }, testFocus, store, 'sess-1');
    expect(result.content[0].text).toContain('Unknown field');
    expect(result.isError).toBe(true);
  });

  it('should handle partial success (mixed valid/invalid)', async () => {
    const result = await handleUpdateFocus({ vehicleType: 'car', coverage: 'premium' }, testFocus, store, 'sess-1');
    expect(result.content[0].text).toContain('Accepted: vehicleType');
    expect(result.content[0].text).toContain('Rejected coverage');
    expect(result.isError).toBe(false); // Not all-error since one was accepted
  });

  it('should reject field that fails custom validation', async () => {
    const result = await handleUpdateFocus({ year_valid: '1990' }, testFocus, store, 'sess-1');
    expect(result.content[0].text).toContain('Year must be >= 2000');
    expect(result.isError).toBe(true);
  });
});

describe('ConfirmFocusTool', () => {
  let store: InMemoryFocusStateStore;

  beforeEach(() => {
    store = new InMemoryFocusStateStore();
  });

  it('should show partial status', async () => {
    await store.set('sess-1', 'intake', 'vehicleType', 'car');
    const result = await handleConfirmFocus(testFocus, store, 'sess-1');
    expect(result.content[0].text).toContain('vehicleType: car');
    expect(result.content[0].text).toContain('Missing required: year, coverage');
    expect(result.content[0].text).toContain('Ready: false');
  });

  it('should show ready when all required fields are filled', async () => {
    await store.set('sess-1', 'intake', 'vehicleType', 'car');
    await store.set('sess-1', 'intake', 'year', 2020);
    await store.set('sess-1', 'intake', 'coverage', 'full');
    const result = await handleConfirmFocus(testFocus, store, 'sess-1');
    expect(result.content[0].text).toContain('Ready: true');
    expect(result.content[0].text).not.toContain('Missing required');
  });
});

describe('FocusToolGenerator', () => {
  it('should generate tools with correct names', () => {
    const store = new InMemoryFocusStateStore();
    const tools = generateFocusTools(testFocus, store, 'sess-1');
    expect(tools).toHaveLength(3);
    expect(tools[0].definition.name).toBe('update_intake_focus');
    expect(tools[1].definition.name).toBe('confirm_intake_focus');
    expect(tools[2].definition.name).toBe('classify_intake_focus');
  });

  it('should generate update tool schema with field properties', () => {
    const store = new InMemoryFocusStateStore();
    const tools = generateFocusTools(testFocus, store, 'sess-1');
    const updateSchema = tools[0].definition.inputSchema;
    expect(updateSchema.type).toBe('object');
    expect(updateSchema.properties).toHaveProperty('vehicleType');
    expect(updateSchema.properties).toHaveProperty('year');
    expect(updateSchema.properties).toHaveProperty('coverage');
  });

  it('should generate enum field with allowed values', () => {
    const store = new InMemoryFocusStateStore();
    const tools = generateFocusTools(testFocus, store, 'sess-1');
    const coverageProp = tools[0].definition.inputSchema.properties!.coverage as Record<string, unknown>;
    expect(coverageProp.enum).toEqual(['basic', 'full']);
  });

  it('should produce working handlers', async () => {
    const store = new InMemoryFocusStateStore();
    const tools = generateFocusTools(testFocus, store, 'sess-1');
    const updateResult = await tools[0].handler({ vehicleType: 'truck' });
    expect(updateResult.content[0].text).toContain('Accepted: vehicleType');
    expect(await store.get('sess-1', 'intake', 'vehicleType')).toBe('truck');

    const confirmResult = await tools[1].handler({});
    expect(confirmResult.content[0].text).toContain('vehicleType: truck');
  });
});
