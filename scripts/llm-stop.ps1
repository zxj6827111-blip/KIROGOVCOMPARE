param(
  [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root ".llm-$Port.pid"

if (-not (Test-Path $pidFile)) {
  Write-Host "PID file not found: $pidFile" -ForegroundColor Yellow
  Write-Host "Tip: find port owner via: npm run ports:llm" -ForegroundColor Yellow
  exit 1
}

$procId = Get-Content $pidFile | Select-Object -First 1
if (-not $procId) {
  Write-Host "Empty PID file: $pidFile" -ForegroundColor Yellow
  exit 1
}

Write-Host "Stopping PID $procId (port $Port)..."
try {
  taskkill /PID $procId /F | Out-Null
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "Stopped." -ForegroundColor Green
} catch {
  Write-Host "Failed to stop PID $procId. You may need to run PowerShell as Administrator." -ForegroundColor Red
  throw
}
