import {
  BeforeGenerateMiddleware,
  Chat,
  ContextInterface,
  GenerateRequestParameters,
  StandardMiddleware
} from '@moc-global/loft-definitions';

export const inputLogger: StandardMiddleware<ContextInterface, GenerateRequestParameters> = async (
  _context,
  payload,
  chain
) => {
  const messageCount = payload.directMessages.length + payload.augmentedContext.length;
  console.log(`[InputMiddleware] Processing ${messageCount} message(s)`);
  chain.next();
  return payload;
};

export const beforeGenerateLogger: BeforeGenerateMiddleware<ContextInterface, GenerateRequestParameters> = async (
  context,
  payload,
  chain
) => {
  console.log(`[BeforeGenerateMiddleware] Session: ${context.session.id}`);
  chain.next();
  return payload;
};

export const afterGenerateLogger: StandardMiddleware<ContextInterface, Chat.GenerateResultMessages> = async (
  _context,
  payload,
  chain
) => {
  console.log('[AfterGenerateMiddleware] Response received');
  chain.next();
  return payload;
};
