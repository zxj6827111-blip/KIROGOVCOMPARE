param(
  [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root ".llm-$Port.pid"

function Get-PortListenerPid {
  param([int]$TargetPort)

  $listener = netstat -ano | Select-String ":$TargetPort" | Where-Object { $_.Line -match "\sLISTENING\s" } | Select-Object -First 1
  if (-not $listener) { return $null }

  try {
    $parts = ($listener.Line -replace "\s+", " ").Trim().Split(' ')
    if ($parts.Length -ge 5) { return [int]$parts[-1] }
  } catch { }

  return $null
}

function Stop-ProcessTree {
  param([int]$TargetPid)

  if (-not $TargetPid -or $TargetPid -le 0) { return }

  $proc = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
  if (-not $proc) {
    Write-Host "Process $TargetPid not found (already stopped)." -ForegroundColor Yellow
    return
  }

  taskkill /PID $TargetPid /T /F 2>&1 | Out-Null
  Start-Sleep -Milliseconds 200
  $stillRunning = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
  if ($stillRunning) {
    Write-Host "Error: PID $TargetPid is still running." -ForegroundColor Red
    exit 1
  }
  Write-Host "Stopped PID $TargetPid." -ForegroundColor Green
}

if (-not (Test-Path $pidFile)) {
  Write-Host "PID file not found: $pidFile" -ForegroundColor Yellow
  $listenerPid = Get-PortListenerPid -TargetPort $Port
  if ($listenerPid) {
    Write-Host "Stopping port owner PID $listenerPid (port $Port)..." -ForegroundColor Yellow
    Stop-ProcessTree -TargetPid $listenerPid
  }
  else {
    Write-Host "No process is listening on port $Port." -ForegroundColor Yellow
  }
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
  Stop-ProcessTree -TargetPid ([int]$procId)
}
catch {
  Write-Host "Warning: Could not stop PID $procId - may already be stopped." -ForegroundColor Yellow
}

$listenerPidAfterStoredStop = Get-PortListenerPid -TargetPort $Port
if ($listenerPidAfterStoredStop) {
  Write-Host "Port $Port is still listening; stopping owner PID $listenerPidAfterStoredStop..." -ForegroundColor Yellow
  Stop-ProcessTree -TargetPid $listenerPidAfterStoredStop
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
