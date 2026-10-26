import { ContextInterface, GenerateRequestParameters, Logger, StandardMiddleware } from '@moc-global/loft-definitions';

const log = new Logger('count-messages');

/**
 * Logs how many messages a request carries, never their text: message text can hold personal data.
 *
 *   chatConstructor.registerInputMiddleware('count-messages', countMessages);
 */
export const countMessages: StandardMiddleware<ContextInterface, GenerateRequestParameters> = (
  context,
  payload,
  chain
) => {
  log.info('Request received', {
    sessionId: context.session.id,
    directMessages: payload.directMessages.length,
    augmentedContext: payload.augmentedContext.length
  });
  chain.next();
  return Promise.resolve(payload);
};
