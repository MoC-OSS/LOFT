import { Agent, Chat } from '@moc-global/loft-definitions';

export async function handleClassifyFocus(
  args: Record<string, unknown>,
  _focus: Agent.Focus
): Promise<Chat.AdditionalToolResult> {
  // The LLM determines the classification based on the user's input
  // and calls this tool with its assessment
  const classification = args.classification as string | undefined;

  let value: Agent.FocusClassification;
  switch (classification?.toUpperCase()) {
    case 'ON_FOCUS':
      value = Agent.FocusClassification.ON_FOCUS;
      break;
    case 'OFF_FOCUS':
      value = Agent.FocusClassification.OFF_FOCUS;
      break;
    default:
      value = Agent.FocusClassification.UNKNOWN;
  }

  return {
    content: [{ type: Chat.AdditionalToolContentType.TEXT, text: `Classification: ${value}` }]
  };
}
