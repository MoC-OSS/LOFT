Follow these steps to update your database and generate TypeScript types & code for your DB tables and columns:

1. **Update your .env file**: Make sure your .env file contains the correct database connection details.

```bash
    DATABASE_URL=postgres://loft_user:loft_pass@localhost/loft_db
    DATABASE_SSL=false
    DATABASE_SCHEMA_NAME=loft_chat_history

    DATABASE_HOST=localhost
    DATABASE_USER=loft_user
    DATABASE_PASSWORD=loft_pass
    DATABASE_NAME=loft_db
    DATABASE_PORT=5432
```

2. **_Add new migration file_** to `./migrations` folder. FileName should be in format `<package.json lib version>.ts`

3. **Apply UP migrations to your database**: Run the following command to apply UP migrations to your database. This will update your database schema according to the migration files.

```bash
    loft-chat-history-pg-migrate <direction> [migration-name]
OR
    loft-chat-history-pg-migrate to-latest
```

4. **Generate TypeScript code for database tables and columns**: After updating your database, you can generate TypeScript code for your tables and columns using the following command:

```bash
    npx kanel
```
