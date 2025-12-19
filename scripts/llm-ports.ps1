param(
  [int]$Port = 8787
)

Write-Host "Checking port $Port..."
# netstat output columns: Proto LocalAddr ForeignAddr State PID
$allLines = netstat -ano | Select-String ":$Port" | ForEach-Object { $_.Line }
$listening = $allLines | Where-Object { $_ -match "\sLISTENING\s" }

if (-not $listening) {
  Write-Host "No LISTENING process found on port $Port." -ForegroundColor Green
  if ($allLines) {
    Write-Host "(Found connections but no listener; e.g. TIME_WAIT/CLOSE_WAIT)" -ForegroundColor DarkYellow
    $allLines | ForEach-Object { Write-Host $_ }
  }
  exit 0
}

$listening | ForEach-Object { Write-Host $_ }

$pids = @()
foreach ($l in $listening) {
  $parts = ($l -replace "\s+", " ").Trim().Split(' ')
  if ($parts.Length -ge 5) {
    $pidVal = [int]$parts[-1]
    if ($pidVal -ne 0) { $pids += $pidVal }
  }
}

$pids = $pids | Sort-Object -Unique
Write-Host "Listener PIDs: $($pids -join ', ')"

foreach ($procId in $pids) {
  try {
    $p = Get-Process -Id $procId -ErrorAction Stop
    Write-Host ("PID {0}: {1}" -f $procId, $p.ProcessName)
  } catch {
    Write-Host ("PID {0}: <cannot query>" -f $procId)
  }
}

Write-Host "To force kill (Admin may be required): taskkill /PID <pid> /F" -ForegroundColor Yellow
