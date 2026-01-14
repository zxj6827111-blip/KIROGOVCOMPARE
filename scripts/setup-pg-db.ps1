# Add PG bin to PATH temporarily
$env:PATH = "$env:PATH;C:\Program Files\PostgreSQL\16\bin"

# Verify Access
$pgVersion = psql --version
Write-Host "Found: $pgVersion" -ForegroundColor Green

# Create Database and User
# We use PGPASSWORD to authenticate as 'postgres' superuser (password set during install)
$env:PGPASSWORD = "postgres"

Write-Host "Configuring Database..." -ForegroundColor Cyan

# Check if user exists, create if not
$userExists = psql -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='postgres'"
if ($userExists -ne '1') {
    # Should not happen as 'postgres' is superuser, but for completeness
    Write-Host "Creating postgres user..."
    psql -U postgres -c "CREATE USER postgres WITH SUPERUSER PASSWORD 'postgres';"
}
else {
    Write-Host "User 'postgres' exists."
}

# Check if DB exists, create if not
$dbExists = psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='gov_report_diff'"
if ($dbExists -ne '1') {
    Write-Host "Creating database 'gov_report_diff'..."
    psql -U postgres -c "CREATE DATABASE gov_report_diff OWNER postgres;"
}
else {
    Write-Host "Database 'gov_report_diff' already exists."
}

Write-Host "PostgreSQL Setup Complete!" -ForegroundColor Green
Write-Host "Connection String: postgres://postgres:postgres@localhost:5432/gov_report_diff" -ForegroundColor Cyan
