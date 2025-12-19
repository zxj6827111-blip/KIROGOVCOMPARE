param(
  [int]$Port = 8787,
  [string]$DbPath = "",
  [string]$LogPath = "",
  [switch]$Force,
  [switch]$ShowWindow
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $DbPath -or $DbPath.Trim().Length -eq 0) {
  $DbPath = Join-Path $root 'data\llm_ingestion.db'
}
if (-not $LogPath -or $LogPath.Trim().Length -eq 0) {
  $logsDir = Join-Path $root 'logs'
  if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }
  $LogPath = Join-Path $logsDir "llm-$Port.log"
}

$errPath = "$LogPath.err"

$net = netstat -ano | Select-String ":$Port" | ForEach-Object { $_.Line }
$listener = $net | Where-Object { $_ -match "\sLISTENING\s" } | Select-Object -First 1
if ($listener -and -not $Force) {
  Write-Host "Port $Port is already LISTENING. Refusing to start." -ForegroundColor Yellow

  $pidVal = $null
  try {
    $parts = ($listener -replace "\s+", " ").Trim().Split(' ')
    if ($parts.Length -ge 5) { $pidVal = [int]$parts[-1] }
  } catch { }

  if ($pidVal -and $pidVal -ne 0) {
    $procName = $null
    try { $procName = (Get-Process -Id $pidVal -ErrorAction Stop).ProcessName } catch { }
    if ($procName) {
      Write-Host ("Owner: PID {0} ({1})" -f $pidVal, $procName) -ForegroundColor Yellow
    } else {
      Write-Host ("Owner: PID {0}" -f $pidVal) -ForegroundColor Yellow
    }
    Write-Host ("Kill: taskkill /PID {0} /F" -f $pidVal) -ForegroundColor Yellow
    Write-Host "(May require running the terminal as Administrator)" -ForegroundColor DarkYellow
  }

  Write-Host "More details: npm run ports:llm" -ForegroundColor Yellow
  Write-Host "Force start (not recommended): powershell -NoProfile -ExecutionPolicy Bypass -File scripts/llm-start.ps1 -Port $Port -Force" -ForegroundColor Yellow
  exit 1
}

$env:PORT = "$Port"
$env:DATABASE_TYPE = 'sqlite'
$env:SQLITE_DB_PATH = $DbPath

$pidFile = Join-Path $root ".llm-$Port.pid"

Write-Host "Starting LLM server on port $Port..."
Write-Host "DB: $DbPath"
Write-Host "Log: $LogPath"
Write-Host "Err: $errPath"

$windowStyle = if ($ShowWindow) { 'Normal' } else { 'Hidden' }

$proc = Start-Process -FilePath "node" -ArgumentList "dist\\index-llm.js" -WorkingDirectory $root -RedirectStandardOutput $LogPath -RedirectStandardError $errPath -WindowStyle $windowStyle -PassThru
$proc.Id | Out-File -FilePath $pidFile -Encoding ascii
Write-Host "Started. PID: $($proc.Id) (pid file: $pidFile)" -ForegroundColor Green
Write-Host "Health: http://127.0.0.1:$Port/api/health"

# Wait up to ~3s for LISTENING to appear (helps avoid immediate ECONNREFUSED right after start)
for ($i = 0; $i -lt 15; $i++) {
  $l = netstat -ano | Select-String ":$Port" | Where-Object { $_.Line -match "\sLISTENING\s" }
  if ($l) { break }
  Start-Sleep -Milliseconds 200
}
