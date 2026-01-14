# Helper to open psql
$env:PATH = "$env:PATH;C:\Program Files\PostgreSQL\16\bin"
$env:PGPASSWORD = "postgres"
psql -U postgres -d gov_report_diff
