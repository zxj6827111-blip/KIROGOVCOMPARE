# Start PostgreSQL Service (Native)
$service = Get-Service postgresql* | Select-Object -First 1
if ($service) {
    Start-Service $service.Name
    Write-Host "Started service: $($service.Name)" -ForegroundColor Green
}
else {
    Write-Host "PostgreSQL service not found!" -ForegroundColor Red
}
