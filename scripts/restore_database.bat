@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

set PGPASSWORD=postgres
set PSQL="C:\Program Files\PostgreSQL\16\bin\psql.exe"
set PG_RESTORE="C:\Program Files\PostgreSQL\16\bin\pg_restore.exe"
set DB_NAME=gov_report_diff
set DB_USER=postgres
set DB_HOST=localhost

echo ========================================
echo 数据库恢复脚本
echo ========================================

REM Step 1: Create kiro_app role if not exists
echo [1/4] 创建 kiro_app 用户 (如果不存在)...
%PSQL% -U %DB_USER% -h %DB_HOST% -c "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kiro_app') THEN CREATE ROLE kiro_app WITH LOGIN PASSWORD 'kiro_app' SUPERUSER; END IF; END $$;"

REM Step 2: Drop and recreate database
echo [2/4] 删除并重建数据库 %DB_NAME%...
%PSQL% -U %DB_USER% -h %DB_HOST% -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%DB_NAME%' AND pid <> pg_backend_pid();"
%PSQL% -U %DB_USER% -h %DB_HOST% -c "DROP DATABASE IF EXISTS %DB_NAME%;"
%PSQL% -U %DB_USER% -h %DB_HOST% -c "CREATE DATABASE %DB_NAME% OWNER kiro_app;"

REM Step 3: Grant permissions
echo [3/4] 授权...
%PSQL% -U %DB_USER% -h %DB_HOST% -d %DB_NAME% -c "GRANT ALL PRIVILEGES ON DATABASE %DB_NAME% TO kiro_app;"
%PSQL% -U %DB_USER% -h %DB_HOST% -d %DB_NAME% -c "GRANT ALL ON SCHEMA public TO kiro_app;"

REM Step 4: Restore data
echo [4/4] 恢复数据 (这可能需要几分钟...)...
%PSQL% -U %DB_USER% -h %DB_HOST% -d %DB_NAME% -f "d:\软件开发\谷歌反重力开发\KIROGOVCOMPARE\gov_data.sql" 2> restore_errors_new.log

echo ========================================
echo 恢复完成！检查 restore_errors_new.log 查看错误
echo ========================================

pause
