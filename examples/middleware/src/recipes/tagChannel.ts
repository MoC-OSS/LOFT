import { ContextInterface, GenerateRequestParameters, StandardMiddleware } from '@moc-global/loft-definitions';

/**
 * Records on each incoming message the channel it came from. `ctx` is stored with the message, so later requests can
 * read it from the chat history. Setting the same value twice changes nothing, so it is safe in Input middleware,
 * which runs on `addMessages()` and on `generate()`.
 *
 *   chatConstructor.registerInputMiddleware('tag-channel', tagChannel('web'));
 */
export function tagChannel(channel: string): StandardMiddleware<ContextInterface, GenerateRequestParameters> {
  return async (_context, payload, chain) => {
    payload.directMessages = payload.directMessages.map((message) => ({
      ...message,
      ctx: { ...message.ctx, channel }
    }));
    chain.next();
    return payload;
  };
}
