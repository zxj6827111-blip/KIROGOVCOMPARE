# Data Migration: SQLite to PostgreSQL

This document describes the process used to migrate all data from SQLite to PostgreSQL.

## Migration Scripts

| Script | Location | Purpose |
|--------|----------|---------|
| `full_schema.sql` | `migrations/postgres/full_schema.sql` | Complete PostgreSQL schema definition (reconstructed from SQLite + TS code) |
| `init-pg-schema.ps1` | `scripts/init-pg-schema.ps1` | Applies the schema (DROPs existing tables and re-creates them) |
| `migrate_to_pg.ts` | `scripts/data_migration/migrate_to_pg.ts` | Node.js script to read SQLite and Insert into Postgres (handles types) |
| `configure-pg-env.ps1` | `scripts/configure-pg-env.ps1` | Appends DB credentials to `.env` |

## How to Re-run Migration

**Warning: This will overwrite data in PostgreSQL!**

1. **Stop the Server**:
   ```powershell
   npm run stop:llm
   ```

2. **Reset Schema**:
   ```powershell
   ./scripts/init-pg-schema.ps1
   ```

3. **Migrate Data**:
   ```powershell
   npx ts-node scripts/data_migration/migrate_to_pg.ts
   ```

4. **Start Server**:
   ```powershell
   npm run restart:llm
   ```

## Schema Changes Note
The migration process discovered some schema discrepancies which were fixed in the Postgres schema:
- `admin_users`: Added `display_name` and `last_login_at`
- `metric_dictionary`: Added `version` and converted boolean fields.
