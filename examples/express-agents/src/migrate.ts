import 'dotenv/config';

import { runChatHistoryPgMigrations } from '@moc-global/loft-chat-history-pg-repository';
import { runSessionPgMigrations } from '@moc-global/loft-session-pg-repository';
import { Pool } from 'pg';

import { env } from './config';

async function migrate() {
  const databaseUrl = `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`;

  // Migration files read schema names directly from process.env
  process.env.DATABASE_SESSION_SCHEMA_NAME = env.LOFT_SESSION_SCHEMA;
  process.env.DATABASE_CHAT_HISTORY_SCHEMA_NAME = env.LOFT_CHAT_HISTORY_SCHEMA;

  const pool = new Pool({ connectionString: databaseUrl });

  console.log('Running session migrations...');
  await runSessionPgMigrations(
    {
      databaseUrl,
      databaseSsl: false,
      direction: 'to-latest',
      schemaName: env.LOFT_SESSION_SCHEMA,
      libraryVersion: '99.99.99'
    },
    pool
  );

  console.log('Running chat history migrations...');
  await runChatHistoryPgMigrations(
    {
      databaseUrl,
      databaseSsl: false,
      direction: 'to-latest',
      schemaName: env.LOFT_CHAT_HISTORY_SCHEMA,
      libraryVersion: '99.99.99'
    },
    pool
  );

  await pool.end();
  console.log('Migrations complete.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
