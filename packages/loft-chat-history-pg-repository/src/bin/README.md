## Usage

1. Create a .env file in the project root directory with the following environment variables:

```bash
DATABASE_URL=postgres://user:password@localhost/db_name
DATABASE_SSL=false
DATABASE_CHAT_HISTORY_SCHEMA_NAME=loft_chat_history
```

2. run command to apply UP migrations to database.

```bash
loft-chat-history-pg-migrate <direction> [migration-name]
```

## Commands:

```bash
loft-chat-history-pg-migrate up                     : Migrate one step up.
loft-chat-history-pg-migrate down                   : Migrate one step down.
loft-chat-history-pg-migrate to-latest              : Migrate to the latest available migration
loft-chat-history-pg-migrate to-current-lib-version : Migrate to the version matching the current library version
loft-chat-history-pg-migrate to <migration-name>    : Migrate to a specific migration
```
