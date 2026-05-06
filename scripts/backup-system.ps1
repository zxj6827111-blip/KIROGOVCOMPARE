$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-ProjectRoot {
    return Split-Path -Parent $PSScriptRoot
}

function Read-EnvFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        $trimmed = $line.Trim()
        if ($trimmed.StartsWith("#")) {
            continue
        }

        $separatorIndex = $trimmed.IndexOf("=")
        if ($separatorIndex -lt 1) {
            continue
        }

        $key = $trimmed.Substring(0, $separatorIndex).Trim()
        $value = $trimmed.Substring($separatorIndex + 1).Trim()

        if ($value.Length -ge 2) {
            $first = $value.Substring(0, 1)
            $last = $value.Substring($value.Length - 1, 1)
            if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }

        $values[$key] = $value
    }

    return $values
}

function Resolve-PostgresBinary {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BinaryName
    )

    $candidateRoots = @(
        (Join-Path $env:ProgramFiles "PostgreSQL\17\bin"),
        (Join-Path $env:ProgramFiles "PostgreSQL\16\bin"),
        (Join-Path $env:ProgramFiles "PostgreSQL\15\bin"),
        (Join-Path $env:ProgramFiles "PostgreSQL\14\bin")
    )

    foreach ($root in $candidateRoots) {
        $candidate = Join-Path $root $BinaryName
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    $command = Get-Command $BinaryName -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    throw "Unable to locate $BinaryName. Install PostgreSQL client tools or add them to PATH."
}

function Assert-LastExitCode {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Action
    )

    if ($LASTEXITCODE -ne 0) {
        throw "$Action failed with exit code $LASTEXITCODE."
    }
}

function Get-DirectorySnapshot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $files = @(Get-ChildItem -LiteralPath $Path -Recurse -File -ErrorAction SilentlyContinue)
    $totalBytes = 0
    foreach ($file in $files) {
        $totalBytes += [int64]$file.Length
    }

    return [ordered]@{
        relative_path = $Path
        files = [int]$files.Count
        total_bytes = $totalBytes
        total_mb = [math]::Round(($totalBytes / 1MB), 2)
    }
}

function Copy-BackupPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProjectRoot,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,
        [Parameter(Mandatory = $true)]
        [string]$FilesRoot
    )

    $source = Join-Path $ProjectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $source)) {
        return $null
    }

    Copy-Item -LiteralPath $source -Destination $FilesRoot -Recurse -Force
    return Get-DirectorySnapshot -Path $source
}

$projectRoot = Get-ProjectRoot
Set-Location -LiteralPath $projectRoot

$envPath = Join-Path $projectRoot ".env"
if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Missing .env file at $envPath"
}

$envValues = Read-EnvFile -Path $envPath
$requiredKeys = @("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD")
foreach ($requiredKey in $requiredKeys) {
    if (-not $envValues.ContainsKey($requiredKey) -or [string]::IsNullOrWhiteSpace($envValues[$requiredKey])) {
        throw "Missing required database setting '$requiredKey' in .env"
    }
}

$pgDump = Resolve-PostgresBinary -BinaryName "pg_dump.exe"
$psql = Resolve-PostgresBinary -BinaryName "psql.exe"

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupsDir = Join-Path $projectRoot "backups"
$backupRoot = Join-Path $backupsDir "system-backup-$timestamp"
$dbRoot = Join-Path $backupRoot "db"
$filesRoot = Join-Path $backupRoot "files"
$metaRoot = Join-Path $backupRoot "meta"
$zipPath = "$backupRoot.zip"

New-Item -ItemType Directory -Force -Path $backupsDir, $backupRoot, $dbRoot, $filesRoot, $metaRoot | Out-Null

$env:PGPASSWORD = $envValues["DB_PASSWORD"]

Write-Host "Verifying database connectivity..."
& $psql `
    --host=$($envValues["DB_HOST"]) `
    --port=$($envValues["DB_PORT"]) `
    --username=$($envValues["DB_USER"]) `
    --dbname=$($envValues["DB_NAME"]) `
    -Atqc "SELECT 1;" | Out-Null
Assert-LastExitCode -Action "Database connectivity check"

$sqlDumpPath = Join-Path $dbRoot "$($envValues["DB_NAME"])-$timestamp.sql"

Write-Host "Exporting PostgreSQL database to $sqlDumpPath"
& $pgDump `
    --host=$($envValues["DB_HOST"]) `
    --port=$($envValues["DB_PORT"]) `
    --username=$($envValues["DB_USER"]) `
    --dbname=$($envValues["DB_NAME"]) `
    --clean `
    --if-exists `
    --no-owner `
    --no-privileges `
    --encoding=UTF8 `
    --file="$sqlDumpPath"
Assert-LastExitCode -Action "PostgreSQL export"

$pathsToCopy = @(
    "data",
    "uploads",
    "logs",
    "output",
    "tmp"
)

$copiedItems = New-Object System.Collections.Generic.List[object]

foreach ($relativePath in $pathsToCopy) {
    Write-Host "Copying $relativePath"
    $snapshot = Copy-BackupPath -ProjectRoot $projectRoot -RelativePath $relativePath -FilesRoot $filesRoot
    if ($null -ne $snapshot) {
        $copiedItems.Add($snapshot)
    }
}

Copy-Item -LiteralPath (Join-Path $projectRoot ".env.example") -Destination $metaRoot -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "docker-compose.yml") -Destination $metaRoot -Force

$restoreInstructions = @"
# System Backup Restore Guide

Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
Source database: $($envValues["DB_NAME"])

Contents:
- db\$(Split-Path -Leaf $sqlDumpPath)
- files\data
- files\uploads
- files\logs
- files\output
- files\tmp
- meta\.env.example
- meta\docker-compose.yml
- meta\backup-manifest.json

Recommended restore order:
1. Put the same project code on the target server.
2. Extract this backup package into a temporary directory.
3. Copy the folders under files\ back to the project root.
4. Configure the server .env for the target database and storage.
5. Restore the PostgreSQL dump with psql.
6. Start the application and verify critical pages and uploads.

Example restore commands on the target server:

Windows:
  psql -h <db-host> -p <db-port> -U <db-user> -d <db-name> -f db\$(Split-Path -Leaf $sqlDumpPath)

Linux:
  psql -h <db-host> -p <db-port> -U <db-user> -d <db-name> -f db/$(Split-Path -Leaf $sqlDumpPath)

Notes:
- This backup intentionally excludes live secrets from .env and frontend/.env.
- files\data is the critical file payload because database storage_path values point into data\uploads.
- files\logs, files\output, and files\tmp are included for completeness but are usually optional for restore.
"@

$manifest = [ordered]@{
    generated_at = (Get-Date).ToString("o")
    project_root = $projectRoot
    backup_root = $backupRoot
    zip_path = $zipPath
    database = [ordered]@{
        host = $envValues["DB_HOST"]
        port = $envValues["DB_PORT"]
        name = $envValues["DB_NAME"]
        user = $envValues["DB_USER"]
        dump_file = (Split-Path -Leaf $sqlDumpPath)
        dump_bytes = (Get-Item -LiteralPath $sqlDumpPath).Length
    }
    included_paths = $copiedItems
    excluded_secret_files = @(
        ".env",
        "frontend/.env"
    )
}

$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $metaRoot "backup-manifest.json") -Encoding UTF8
Set-Content -LiteralPath (Join-Path $metaRoot "RESTORE.md") -Value $restoreInstructions -Encoding UTF8

if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

Write-Host "Compressing backup to $zipPath"
Compress-Archive -LiteralPath $backupRoot -DestinationPath $zipPath -CompressionLevel Optimal

$zipItem = Get-Item -LiteralPath $zipPath

Write-Host ""
Write-Host "Backup completed successfully."
Write-Host "Backup directory: $backupRoot"
Write-Host "Backup archive:   $zipPath"
Write-Host "Archive size MB:  $([math]::Round($zipItem.Length / 1MB, 2))"
