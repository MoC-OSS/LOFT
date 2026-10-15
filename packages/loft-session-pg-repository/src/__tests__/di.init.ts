import 'reflect-metadata';

import { Container } from 'inversify';
import { PostgresDialect } from 'kysely';

import { SessionRepositoryConstructor } from '../SessionRepositoryConstructor';
import { config } from './config';
import { pool } from './db';

const { DATABASE_SESSION_SCHEMA_NAME } = config;

const testContainer = new Container();

// Create the PostgreSQL dialect for Kysely
const postgresDialect = new PostgresDialect({
  pool
});

// Initialize the repository constructor
const sessionRepoConstructor = new SessionRepositoryConstructor(postgresDialect, {
  schema: DATABASE_SESSION_SCHEMA_NAME
});

// Initialize the container
sessionRepoConstructor.initializeContainer(testContainer);

// Get the repository instance
const sessionRepo = sessionRepoConstructor.getInstance();

export { sessionRepo, testContainer };
