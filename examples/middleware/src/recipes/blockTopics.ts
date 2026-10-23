import {
  BeforeGenerateMiddleware,
  ContextInterface,
  GenerateRequestParameters,
  Type
} from '@moc-global/loft-definitions';

// The text of the user's messages in this request, or else of the message waiting in the history
function newestUserText(context: ContextInterface, payload: GenerateRequestParameters): string {
  const isUser = (message: { role: Type.LLM.UnifiedMessageRole }) => message.role === Type.LLM.UnifiedMessageRole.user;
  const messages = payload.directMessages.filter(isUser);
  const pending = context.chatHistory.messages.at(-1);
  const newest = messages.at(-1) ?? (pending && isUser(pending) ? pending : undefined);
  return (newest?.content ?? []).map((part) => (part.type === 'text' ? part.text : '')).join(' ');
}

/**
 * Answers with a fixed reply, without calling the model, when the user's newest message mentions a blocked topic.
 * A keyword list is a business rule, not a security control: for prompt injection use `injectionGuard` from
 * `@moc-global/loft-middleware/injection`.
 *
 *   chatConstructor.registerBeforeGenerateMiddleware('block-topics', blockTopics(['refund', 'lawsuit'], 'Please call us.'));
 */
export function blockTopics(
  topics: readonly string[],
  reply: string
): BeforeGenerateMiddleware<ContextInterface, GenerateRequestParameters> {
  const words = topics.map((topic) => topic.toLowerCase());
  return async (context, payload, chain) => {
    const text = newestUserText(context, payload).toLowerCase();
    if (words.some((word) => text.includes(word))) {
      chain.preventGeneration({
        content: [{ type: 'text', text: reply }],
        role: Type.LLM.UnifiedMessageRole.assistant
      });
      return payload;
    }
    chain.next();
    return payload;
  };
}
