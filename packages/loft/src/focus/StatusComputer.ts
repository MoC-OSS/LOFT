import type { Agent } from '@moc-global/loft-definitions';

export function computeFocusStatus(focus: Agent.Focus, stored: Record<string, unknown>): Agent.FocusStatus {
  const filled: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const field of focus.fields) {
    const value = stored[field.key] ?? (field.default !== undefined ? field.default : undefined);
    if (value !== undefined) {
      filled[field.key] = value;
    } else if (field.required) {
      missing.push(field.key);
    }
  }

  return {
    agentName: focus.agentName,
    filled,
    missing,
    hasData: Object.keys(filled).length > 0,
    ready: missing.length === 0
  };
}
