import { Chat, Logger, Schema, Type } from '@moc-global/loft-definitions';

export function mapChatPayloadToSMGMessages(
  sessionId: Type.Entity.Session['id'],
  correlatorId: string,
  chatInputPayload: Chat.ChatInputPayload,
  action: Type.SMG.MessageAction,
  log: Logger
): Type.SMG.CreateMessage[] {
  const { messages: payloadMessages } = chatInputPayload;
  log.trace(`mapping chat payload to SMG messages, correlatorId: ${correlatorId}`);
  try {
    const messages: Type.Entity.CreateMessage[] = payloadMessages.map((message) => ({
      correlatorId,
      sessionId,
      llmName: '', // TODO: review this
      manifestName: '', // TODO: review this
      content: message.content,
      action,
      role: message.role,
      author: message.author,
      ctx: message.ctx || {},
      llmIgnore: false
    }));

    return Schema.SMG.CreateMessage.array().parse(messages);
  } catch (error) {
    log.error(`Error while mapChatPayloadToSMGMessages/validation, correlatorId: ${correlatorId}`, error);
    throw error;
  }
}

// export function getPendingMessagesForLLM(
//   messages: Type.Entity.Message[],
//   firstOfPendingMessagesId?: Type.SMG.Message['id']
// ): Type.Entity.Message[] {
//   if (!firstOfPendingMessagesId) return messages;

//   const latestMessages: Type.Entity.Message[] = [];

//   const isMessageByFirstOfPendingMessagesIdExists = messages.find((message) => message.id === firstOfPendingMessagesId);

//   if (!isMessageByFirstOfPendingMessagesIdExists) return latestMessages;

//   // Sort messages by sequenceId in descending order, latest message first
//   const sortedMessages = [...messages].sort((a, b) => Number(b.sequenceId) - Number(a.sequenceId));

//   for (const message of sortedMessages) {
//     latestMessages.push(message);
//     if (message.id === firstOfPendingMessagesId) {
//       break;
//     }
//   }
//   // Reverse the array to get the messages in ascending order
//   return latestMessages.reverse();
// }
