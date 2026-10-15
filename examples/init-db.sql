-- LOFT Examples: Database Initialization (for express-full Docker PostgreSQL)
-- This runs automatically when the Docker container starts for the first time.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA IF NOT EXISTS loft_session;
CREATE SCHEMA IF NOT EXISTS loft_chat_history;
