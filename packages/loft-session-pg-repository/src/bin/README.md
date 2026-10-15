## Usage

1. Create a .env file in the project root directory with the following environment variables:

```bash
DATABASE_URL=postgres://user:password@localhost/db_name
DATABASE_SSL=false
DATABASE_SESSION_SCHEMA_NAME=loft_session
```

2. run command to apply UP migrations to database.

```bash
loft-session-pg-migrate <direction> [migration-name]
```

## Commands:

```bash
loft-session-pg-migrate up                     : Migrate one step up.
loft-session-pg-migrate down                   : Migrate one step down.
loft-session-pg-migrate to-latest              : Migrate to the latest available migration
loft-session-pg-migrate to-current-lib-version : Migrate to the version matching the current library version
loft-session-pg-migrate to <migration-name>    : Migrate to a specific migration
```
