import os
import subprocess
import sys

# 配置
PG_BIN = r"C:\Program Files\PostgreSQL\16\bin"
os.environ["PATH"] += os.pathsep + PG_BIN
os.environ["PGPASSWORD"] = "postgres"
DB_NAME = "gov_report_diff"
BACKUP_FILE = r"d:\软件开发\谷歌反重力开发\数据库备份\gov_data.sql"
DB_USER = "postgres"

def run_cmd(cmd, ignore_error=False):
    print(f">>> Running command...")
    try:
        # 使用 shell=True 让 cmd解析命令
        subprocess.run(cmd, shell=True, check=True)
    except subprocess.CalledProcessError as e:
        if not ignore_error:
            print(f"Error running command: {e}")
            sys.exit(1)
        else:
            print(f"Ignored warning key.")

print(">>> Step 1/4: Killing connections...")
kill_sql = f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{DB_NAME}' AND pid <> pg_backend_pid();"
run_cmd(f'psql -U {DB_USER} -d postgres -c "{kill_sql}"', ignore_error=True)

print(">>> Step 2/4: Creating role kiro_app...")
# 简单尝试创建，忽略错误
run_cmd(f'psql -U {DB_USER} -d postgres -c "CREATE ROLE kiro_app WITH LOGIN PASSWORD \'postgres\' SUPERUSER;"', ignore_error=True)

print(">>> Step 3/4: Resetting Schema...")
reset_sql = "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;"
run_cmd(f'psql -U {DB_USER} -d {DB_NAME} -c "{reset_sql}"')

print(f">>> Step 4/4: Importing Data from {BACKUP_FILE}...")
if not os.path.exists(BACKUP_FILE):
    print(f"Error: File not found at path: {BACKUP_FILE}")
    # 尝试列出目录看发生了什么
    import glob
    print(f"Files in directory: {glob.glob(os.path.dirname(BACKUP_FILE) + '/*')}")
    sys.exit(1)

# 关键：使用列表形式传递给 subprocess (shell=False) 可以避免引用问题，但在 Windows 上往往 shell=True 更方便处理 PATH
# 我们尝试直接构造完整的命令行字符串
psql_cmd = f'psql -U {DB_USER} -d {DB_NAME} -q -f "{BACKUP_FILE}"'
run_cmd(psql_cmd)

print(">>> DONE.")
