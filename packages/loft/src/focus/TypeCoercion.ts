import { Agent } from '@moc-global/loft-definitions';

export interface CoercionResult {
  success: boolean;
  value?: unknown;
  error?: string;
}

export function coerceValue(value: unknown, field: Agent.FocusField): CoercionResult {
  switch (field.type) {
    case Agent.FocusFieldType.STRING:
      return { success: true, value: String(value) };

    case Agent.FocusFieldType.NUMBER: {
      if (value === '' || value === null || value === undefined) {
        return { success: false, error: `Cannot convert empty value to number` };
      }
      const num = Number(value);
      if (isNaN(num)) {
        return { success: false, error: `Cannot convert "${value}" to number` };
      }
      return { success: true, value: num };
    }

    case Agent.FocusFieldType.BOOLEAN: {
      if (typeof value === 'boolean') return { success: true, value };
      const str = String(value).toLowerCase();
      if (str === 'true') return { success: true, value: true };
      if (str === 'false') return { success: true, value: false };
      return { success: false, error: `Cannot convert "${value}" to boolean — expected "true" or "false"` };
    }

    case Agent.FocusFieldType.ENUM: {
      const str = String(value);
      if (!field.values || !field.values.includes(str)) {
        return {
          success: false,
          error: `Invalid enum value "${str}" — allowed: ${(field.values ?? []).join(', ')}`
        };
      }
      return { success: true, value: str };
    }

    case Agent.FocusFieldType.DATE: {
      const str = String(value);
      const date = new Date(str);
      if (isNaN(date.getTime())) {
        return { success: false, error: `Cannot parse "${str}" as ISO 8601 date` };
      }
      return { success: true, value: date.toISOString() };
    }

    default:
      return { success: false, error: `Unknown field type: ${field.type}` };
  }
}

export function validateField(value: unknown, field: Agent.FocusField): CoercionResult {
  const coerced = coerceValue(value, field);
  if (!coerced.success) return coerced;

  if (field.validate) {
    const result = field.validate(coerced.value);
    if (result === false) {
      return { success: false, error: `Custom validation failed for field "${field.key}"` };
    }
    if (typeof result === 'string') {
      return { success: false, error: result };
    }
  }

  return coerced;
}
