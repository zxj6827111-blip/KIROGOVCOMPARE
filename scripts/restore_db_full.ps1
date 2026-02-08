$ErrorActionPreference = "Continue" # 改为 Continue 以便看到错误但不中断

# 配置
$env:PATH = "$env:PATH;C:\Program Files\PostgreSQL\16\bin"
$env:PGPASSWORD = "postgres"
$DB_NAME = "gov_report_diff"
# 确保使用引号包裹路径
$BACKUP_FILE = "d:\软件开发\谷歌反重力开发\数据库备份\gov_data.sql"
$DB_USER = "postgres"

Write-Host ">>> Step 1/4: Killing connections..."
psql -U $DB_USER -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" 2>&1 | Out-Null

Write-Host ">>> Step 2/4: Creating role kiro_app..."
# 直接创建，如果存在会报错但被 catch/忽略
try {
    psql -U $DB_USER -d postgres -c "CREATE ROLE kiro_app WITH LOGIN PASSWORD 'postgres' SUPERUSER;" 2>&1 | Out-Null
}
catch {}

Write-Host ">>> Step 3/4: Resetting Schema..."
psql -U $DB_USER -d $DB_NAME -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;"

Write-Host ">>> Step 4/4: Importing Data from $BACKUP_FILE..."
if (-not (Test-Path $BACKUP_FILE)) {
    Write-Error "File not found: $BACKUP_FILE"
    exit 1
}

$startTime = Get-Date

# 直接调用，不通过 cmd /c，避免转义问题
& psql -U $DB_USER -d $DB_NAME -q -f "$BACKUP_FILE"

$duration = (Get-Date) - $startTime
Write-Host ">>> DONE. Time taken: $($duration.TotalSeconds) seconds"
