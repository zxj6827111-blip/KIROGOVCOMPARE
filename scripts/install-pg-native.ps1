# Install PostgreSQL 16 using Winget
# Arguments explain:
# --silent: Silent/Quiet install
# --accept-source-agreements: Auto-accept winget source agreements
# --accept-package-agreements: Auto-accept package license
# --override: Pass arguments to the underlying EnterpriseDB installer
#   --mode unattended: No UI
#   --superpassword "postgres": Set 'postgres' user password to 'postgres'
#   --servicepassword "postgres": Set system service account password (if needed)

Write-Host "Installing PostgreSQL 16..." -ForegroundColor Cyan

winget install --id PostgreSQL.PostgreSQL.16 --exact --scope machine --silent --accept-source-agreements --accept-package-agreements --override "--mode unattended --superpassword ""postgres"" --servicepassword ""postgres"""

if ($LASTEXITCODE -eq 0) {
    Write-Host "Installation started/completed. Please verify service status." -ForegroundColor Green
    Write-Host "You may need to add C:\Program Files\PostgreSQL\16\bin to your PATH." -ForegroundColor Yellow
}
else {
    Write-Host "Installation failed. Winget exit code: $LASTEXITCODE" -ForegroundColor Red
}
