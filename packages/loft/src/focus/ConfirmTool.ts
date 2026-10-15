import { type Agent, Chat } from '@moc-global/loft-definitions';

import { computeFocusStatus } from './StatusComputer';

export async function handleConfirmFocus(
  focus: Agent.Focus,
  store: Agent.FocusStateStore,
  sessionId: string
): Promise<Chat.AdditionalToolResult> {
  const storedValues = await store.getAll(sessionId, focus.agentName);
  const status = computeFocusStatus(focus, storedValues);

  const lines: string[] = [];
  if (Object.keys(status.filled).length > 0) {
    lines.push('Filled fields:');
    for (const [key, value] of Object.entries(status.filled)) {
      lines.push(`  ${key}: ${String(value)}`);
    }
  }
  if (status.missing.length > 0) {
    lines.push(`Missing required: ${status.missing.join(', ')}`);
  }
  lines.push(`Ready: ${status.ready}`);

  return {
    content: [{ type: Chat.AdditionalToolContentType.TEXT, text: lines.join('\n') }]
  };
}
