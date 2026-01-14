# Switch .env to use PostgreSQL
$envFile = ".env"
if (Test-Path $envFile) {
    $content = Get-Content $envFile
    $newContent = $content -replace "DATABASE_TYPE=sqlite", "DATABASE_TYPE=postgres"
    $newContent | Set-Content $envFile
    Write-Host "Switched .env to DATABASE_TYPE=postgres" -ForegroundColor Green
}
else {
    Write-Host ".env file not found!" -ForegroundColor Red
}
