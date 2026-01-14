$env:PATH = "$env:PATH;C:\Program Files\PostgreSQL\16\bin"
$env:PGPASSWORD = "postgres"
$env:PGCLIENTENCODING = "UTF8"
psql -U postgres -d gov_report_diff -f migrations/postgres/full_schema.sql
