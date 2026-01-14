param(
  [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root ".llm-$Port.pid"

if (-not (Test-Path $pidFile)) {
  Write-Host "PID file not found: $pidFile" -ForegroundColor Yellow
  Write-Host "Tip: find port owner via: npm run ports:llm" -ForegroundColor Yellow
  exit 0
}

$procId = Get-Content $pidFile | Select-Object -First 1
if (-not $procId) {
  Write-Host "Empty PID file: $pidFile" -ForegroundColor Yellow
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  exit 0
}

Write-Host "Stopping PID $procId (port $Port)..."
try {
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($proc) {
    taskkill /PID $procId /F 2>&1 | Out-Null
    Start-Sleep -Milliseconds 200
    $stillRunning = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($stillRunning) {
      Write-Host "Error: PID $procId is still running." -ForegroundColor Red
      exit 1
    }
    Write-Host "Stopped." -ForegroundColor Green
  }
  else {
    Write-Host "Process $procId not found (already stopped)." -ForegroundColor Yellow
  }
}
catch {
  Write-Host "Warning: Could not stop PID $procId - may already be stopped." -ForegroundColor Yellow
}
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue

