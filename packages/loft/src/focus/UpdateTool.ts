import { type Agent, Chat } from '@moc-global/loft-definitions';

import { computeFocusStatus } from './StatusComputer';
import { validateField } from './TypeCoercion';

export async function handleUpdateFocus(
  args: Record<string, unknown>,
  focus: Agent.Focus,
  store: Agent.FocusStateStore,
  sessionId: string
): Promise<Chat.AdditionalToolResult> {
  const accepted: string[] = [];
  const rejected: Array<{ key: string; error: string }> = [];
  const fieldsByKey = new Map(focus.fields.map((f) => [f.key, f]));
  const pendingWrites: Array<{ key: string; value: unknown }> = [];

  for (const [key, value] of Object.entries(args)) {
    const field = fieldsByKey.get(key);
    if (!field) {
      rejected.push({ key, error: `Unknown field "${key}"` });
      continue;
    }

    const result = validateField(value, field);
    if (result.success) {
      pendingWrites.push({ key, value: result.value });
      accepted.push(key);
    } else {
      rejected.push({ key, error: result.error! });
    }
  }

  // Write all accepted values concurrently — important for async backends (Redis, PG).
  await Promise.all(pendingWrites.map(({ key, value }) => store.set(sessionId, focus.agentName, key, value)));

  // Compute current status for the response.
  // Re-invoke resolveFields with the updated stored values so computeFocusStatus uses
  // the up-to-date field set (e.g. conditionally added/hidden fields after new values stored).
  const storedValues = await store.getAll(sessionId, focus.agentName);
  const effectiveFields = focus.resolveFields
    ? focus.resolveFields({ fields: focus.fields, filled: storedValues })
    : focus.fields;
  const status = computeFocusStatus({ ...focus, fields: effectiveFields }, storedValues);

  const lines: string[] = [];
  if (accepted.length > 0) lines.push(`Accepted: ${accepted.join(', ')}`);
  if (rejected.length > 0) {
    for (const r of rejected) lines.push(`Rejected ${r.key}: ${r.error}`);
  }
  lines.push(`Status: ${status.ready ? 'ready' : `missing: ${status.missing.join(', ')}`}`);

  return {
    content: [{ type: Chat.AdditionalToolContentType.TEXT, text: lines.join('\n') }],
    isError: rejected.length > 0 && accepted.length === 0
  };
}
