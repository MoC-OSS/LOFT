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
  const texts = payload.directMessages.flatMap((m) => m.content.filter((c) => c.type === 'text').map((c) => c.text));
  console.log(`[Middleware:Input] ${texts.join(' ').slice(0, 100)}`);
  chain.next();
  return payload;
};

export const beforeGenerateLogger: BeforeGenerateMiddleware<ContextInterface, GenerateRequestParameters> = async (
  context,
  payload,
  chain
) => {
  console.log(`[Middleware:BeforeGenerate] session=${context.session.id}`);
  chain.next();
  return payload;
};

export const afterGenerateLogger: StandardMiddleware<ContextInterface, Chat.GenerateResultMessages> = async (
  _context,
  payload,
  chain
) => {
  const tokens = payload.llmResponse.usage;
  console.log(`[Middleware:AfterGenerate] tokens=${tokens?.inputTokens ?? '?'}in/${tokens?.outputTokens ?? '?'}out`);
  chain.next();
  return payload;
};
