import { Agent } from '@moc-global/loft-definitions';
import { describe, expect, it } from 'vitest';

import { coerceValue, validateField } from '../../../focus/TypeCoercion';

describe('coerceValue', () => {
  it('should coerce string to number', () => {
    const field: Agent.FocusField = {
      key: 'year',
      type: Agent.FocusFieldType.NUMBER,
      required: true,
      description: 'Year'
    };
    expect(coerceValue('2020', field)).toEqual({ success: true, value: 2020 });
  });

  it('should reject invalid number', () => {
    const field: Agent.FocusField = {
      key: 'year',
      type: Agent.FocusFieldType.NUMBER,
      required: true,
      description: 'Year'
    };
    const result = coerceValue('abc', field);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot convert');
  });

  it('should reject empty string as number', () => {
    const field: Agent.FocusField = {
      key: 'year',
      type: Agent.FocusFieldType.NUMBER,
      required: true,
      description: 'Year'
    };
    expect(coerceValue('', field).success).toBe(false);
    expect(coerceValue(null, field).success).toBe(false);
    expect(coerceValue(undefined, field).success).toBe(false);
  });

  it('should coerce string to boolean', () => {
    const field: Agent.FocusField = {
      key: 'active',
      type: Agent.FocusFieldType.BOOLEAN,
      required: true,
      description: 'Active'
    };
    expect(coerceValue('true', field)).toEqual({ success: true, value: true });
    expect(coerceValue('false', field)).toEqual({ success: true, value: false });
    expect(coerceValue('True', field)).toEqual({ success: true, value: true });
  });

  it('should reject invalid boolean', () => {
    const field: Agent.FocusField = {
      key: 'active',
      type: Agent.FocusFieldType.BOOLEAN,
      required: true,
      description: 'Active'
    };
    expect(coerceValue('yes', field).success).toBe(false);
  });

  it('should parse ISO date string', () => {
    const field: Agent.FocusField = {
      key: 'date',
      type: Agent.FocusFieldType.DATE,
      required: true,
      description: 'Date'
    };
    const result = coerceValue('2020-01-15T00:00:00.000Z', field);
    expect(result.success).toBe(true);
    expect(result.value).toBe('2020-01-15T00:00:00.000Z');
  });

  it('should reject invalid date', () => {
    const field: Agent.FocusField = {
      key: 'date',
      type: Agent.FocusFieldType.DATE,
      required: true,
      description: 'Date'
    };
    expect(coerceValue('not-a-date', field).success).toBe(false);
  });

  it('should validate enum values', () => {
    const field: Agent.FocusField = {
      key: 'coverage',
      type: Agent.FocusFieldType.ENUM,
      required: true,
      description: 'Coverage',
      values: ['basic', 'full']
    };
    expect(coerceValue('basic', field)).toEqual({ success: true, value: 'basic' });
    expect(coerceValue('premium', field).success).toBe(false);
  });

  it('should pass strings through as-is', () => {
    const field: Agent.FocusField = {
      key: 'name',
      type: Agent.FocusFieldType.STRING,
      required: true,
      description: 'Name'
    };
    expect(coerceValue('John', field)).toEqual({ success: true, value: 'John' });
  });
});

describe('validateField', () => {
  it('should run custom validate function', () => {
    const field: Agent.FocusField = {
      key: 'year',
      type: Agent.FocusFieldType.NUMBER,
      required: true,
      description: 'Year',
      validate: (v) => (v as number) >= 2000 || 'Year must be >= 2000'
    };
    expect(validateField('2020', field).success).toBe(true);
    const fail = validateField('1990', field);
    expect(fail.success).toBe(false);
    expect(fail.error).toBe('Year must be >= 2000');
  });

  it('should handle validate returning false', () => {
    const field: Agent.FocusField = {
      key: 'name',
      type: Agent.FocusFieldType.STRING,
      required: true,
      description: 'Name',
      validate: () => false
    };
    const result = validateField('test', field);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Custom validation failed');
  });
});
