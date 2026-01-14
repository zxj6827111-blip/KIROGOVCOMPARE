# Local PostgreSQL Setup Guide

PostgreSQL 16 has been installed and configured locally for this project.

## Scripts Created

The following PowerShell scripts are located in `scripts/`:

| Script | Purpose |
|--------|---------|
| `install-pg-native.ps1` | (Run Once) Installs PostgreSQL 16 via Winget |
| `setup-pg-db.ps1` | (Run Once) Configures `gov_report_diff` database and `postgres` user |
| `pg-start.ps1` | Starts the PostgreSQL service |
| `pg-stop.ps1` | Stops the PostgreSQL service |
| `switch-to-pg.ps1` | Updates `.env` to use `DATABASE_TYPE=postgres` |
| `pg-cli.ps1` | Opens the `psql` command line interface |

## How to Switch to PostgreSQL

1. **Verify Service is Running**:
   ```powershell
   ./scripts/pg-start.ps1
   ```

2. **Switch Configuration**:
   ```powershell
   ./scripts/switch-to-pg.ps1
   ```
   This will update your `.env` file setting `DATABASE_TYPE=postgres`.

3. **Verify Connection**:
   Restart the backend:
   ```powershell
   npm run restart:llm
   ```

## Connection Details

- **Host**: localhost
- **Port**: 5432
- **Database**: gov_report_diff
- **User**: postgres
- **Password**: postgres
- **Connection String**: `postgres://postgres:postgres@localhost:5432/gov_report_diff`
