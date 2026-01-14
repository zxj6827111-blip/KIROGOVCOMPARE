# Stop PostgreSQL Service (Native)
$service = Get-Service postgresql* | Select-Object -First 1
if ($service) {
    Stop-Service $service.Name
    Write-Host "Stopped service: $($service.Name)" -ForegroundColor Yellow
}
else {
    Write-Host "PostgreSQL service not found!" -ForegroundColor Red
}
