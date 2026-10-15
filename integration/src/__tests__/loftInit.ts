import {
  ChatConstructor,
  FsRepositoryConstructor,
  LoftConstructor,
  ManifestManagerConstructor
} from '@moc-global/loft';
import {
  ChatHistoryPostgresDialect,
  ChatHistoryRepositoryConstructor
} from '@moc-global/loft-chat-history-pg-repository';
import { Chat, Interface, Strategy } from '@moc-global/loft-definitions';
import { SessionPostgresDialect, SessionRepositoryConstructor } from '@moc-global/loft-session-pg-repository';

import { env } from './config';
import type { TestDatabaseInstance } from './initDB';

export function createChatConstructor(db: TestDatabaseInstance): ChatConstructor {
  return new ChatConstructor(
    new SessionRepositoryConstructor(new SessionPostgresDialect({ pool: db.pool }), { schema: db.sessionSchema }),
    new ChatHistoryRepositoryConstructor(new ChatHistoryPostgresDialect({ pool: db.pool }), {
      schema: db.chatHistorySchema
    })
  );
}

export function createLoftConstructor(chatConstructor: ChatConstructor, tracer?: Strategy.Tracer.TracerFactory) {
  const manifestRepository = new FsRepositoryConstructor();
  const manifestManagerConstructor = new ManifestManagerConstructor(manifestRepository, {
    manifestPath: env.LOFT_MANIFEST_PATH,
    errorPath: env.LOFT_MANIFEST_ERROR_PATH,
    cacheExpirationTime: env.LOFT_MANIFEST_CACHE_EXPIRATION
  });

  return new LoftConstructor<Chat.ChatInterface>(
    { logLevel: Interface.LogLevel[env.LOFT_LOG_LEVEL as keyof typeof Interface.LogLevel] },
    manifestManagerConstructor,
    chatConstructor,
    tracer
  );
}
