import { Repository, Type } from '@moc-global/loft-definitions';

export function createSingleUseAppendMessageFunction(appendFn: Repository.ChatHistory['addMessages']) {
  let isCalled = false;
  return async (
    sessionId: Type.Entity.Session['id'],
    message: Type.Entity.CreateMessage
  ): Promise<Type.Entity.Message> => {
    if (!isCalled) {
      const result = await appendFn(sessionId, [message]);
      isCalled = true;

      // Get the message entity from the result array
      // We assume the first message in the result corresponds to the one we just added
      if (result.length > 0) {
        return result[0];
      }

      throw new Error('No message was returned from the repository');
    } else {
      throw new Error('Append function can only be called once');
    }
  };
}
