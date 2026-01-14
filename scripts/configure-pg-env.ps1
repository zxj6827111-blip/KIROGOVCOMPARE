$envFile = ".env"
Add-Content $envFile "`nDB_HOST=localhost"
Add-Content $envFile "DB_PORT=5432"
Add-Content $envFile "DB_NAME=gov_report_diff"
Add-Content $envFile "DB_USER=postgres"
Add-Content $envFile "DB_PASSWORD=postgres"
Write-Host "Added Postgres config to .env" -ForegroundColor Green
