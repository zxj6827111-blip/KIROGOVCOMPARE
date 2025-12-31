#!/usr/bin/env bash

set -euo pipefail

# 注意：测试脚本使用的 SQLITE_DB_PATH 必须与运行中的服务保持一致。
# 若服务以默认配置启动（process.cwd()/data/llm_dev.db），无需修改；
# 如服务通过环境变量指定了其他路径，请将同样的值传给脚本。

BASE_URL=${BASE_URL:-http://localhost:3000/api}
SQLITE_DB_PATH=${SQLITE_DB_PATH:-data/llm_dev.db}
PDF_PATH=${PDF_PATH:-resources/sample-upload.pdf}

PYTHON_BIN=${PYTHON_BIN:-$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)}
if [ -z "${PYTHON_BIN}" ]; then
  echo "python3 或 python 未安装" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 command is required" >&2
  exit 1
fi

mkdir -p "$(dirname "${SQLITE_DB_PATH}")"

echo "[setup] initializing sqlite schema at ${SQLITE_DB_PATH}"
sqlite3 "${SQLITE_DB_PATH}" < migrations/sqlite/001_llm_ingestion_schema.sql
sqlite3 "${SQLITE_DB_PATH}" < migrations/sqlite/002_report_version_parses.sql

echo "[setup] seeding region #1"
sqlite3 "${SQLITE_DB_PATH}" "INSERT OR IGNORE INTO regions (id, code, name, province) VALUES (1, 'demo', '演示地区', '演示省份')"

if [ ! -f "${PDF_PATH}" ]; then
  echo "[error] sample PDF not found at ${PDF_PATH}" >&2
  exit 1
fi

echo "[upload] uploading report PDF"
UPLOAD_RESPONSE=$(curl -s -w "\n%{http_code}" -F region_id=1 -F year=2024 -F file=@"${PDF_PATH}" "${BASE_URL}/reports")
UPLOAD_BODY=$(echo "${UPLOAD_RESPONSE}" | sed '$d')
UPLOAD_STATUS=$(echo "${UPLOAD_RESPONSE}" | tail -n 1)
echo "status=${UPLOAD_STATUS} body=${UPLOAD_BODY}"

if [[ "${UPLOAD_STATUS}" != "201" && "${UPLOAD_STATUS}" != "409" ]]; then
  echo "[error] upload should return 201 or 409" >&2
  exit 1
fi

REPORT_ID=$(UPLOAD_BODY="${UPLOAD_BODY}" ${PYTHON_BIN} - <<'PY'
import json, os
body = os.environ.get('UPLOAD_BODY', '{}')
try:
    data = json.loads(body)
    print(data.get('report_id', ''))
except Exception:
    print('')
PY
)
VERSION_ID=$(UPLOAD_BODY="${UPLOAD_BODY}" ${PYTHON_BIN} - <<'PY'
import json, os
body = os.environ.get('UPLOAD_BODY', '{}')
try:
    data = json.loads(body)
    print(data.get('version_id', ''))
except Exception:
    print('')
PY
)

if [[ -z "${REPORT_ID}" || -z "${VERSION_ID}" ]]; then
  echo "[error] missing report_id or version_id in upload response" >&2
  exit 1
fi

echo "[jobs] polling version ${VERSION_ID} until succeeded"
STATUS="queued"
for attempt in $(seq 1 30); do
  JOB_RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/jobs/${VERSION_ID}")
  JOB_BODY=$(echo "${JOB_RESPONSE}" | sed '$d')
  JOB_STATUS_CODE=$(echo "${JOB_RESPONSE}" | tail -n 1)

  if [[ "${JOB_STATUS_CODE}" != "200" ]]; then
    echo "[error] expected job fetch to return 200, got ${JOB_STATUS_CODE}" >&2
    exit 1
  fi

  STATUS=$(JOB_BODY="${JOB_BODY}" ${PYTHON_BIN} - <<'PY'
import json, os
body = os.environ.get('JOB_BODY', '{}')
try:
    data = json.loads(body)
    print(data.get('status', ''))
except Exception:
    print('')
PY
  )

  echo "attempt=${attempt} status=${STATUS}"

  if [[ "${STATUS}" == "succeeded" ]]; then
    break
  fi

  if [[ "${STATUS}" == "failed" ]]; then
    echo "[error] job failed early: ${JOB_BODY}" >&2
    exit 1
  fi

  sleep 2
done

if [[ "${STATUS}" != "succeeded" ]]; then
  echo "[error] job did not finish successfully" >&2
  exit 1
fi

echo "[reports] fetching list"
LIST_RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/reports?region_id=1&year=2024")
LIST_BODY=$(echo "${LIST_RESPONSE}" | sed '$d')
LIST_STATUS=$(echo "${LIST_RESPONSE}" | tail -n 1)

echo "list_status=${LIST_STATUS} body=${LIST_BODY}"

if [[ "${LIST_STATUS}" != "200" ]]; then
  echo "[error] expected list to return 200" >&2
  exit 1
fi

LIST_BODY="${LIST_BODY}" REPORT_ID="${REPORT_ID}" ${PYTHON_BIN} - <<'PY'
import json, os, sys
body = os.environ.get('LIST_BODY', '{}')
report_id = os.environ.get('REPORT_ID')
try:
    data = json.loads(body)
    items = data.get('data', [])
except Exception as exc:
    sys.exit(f"failed to parse list response: {exc}")

if not isinstance(items, list) or not items:
    sys.exit('list response missing data array')

matched = None
for item in items:
    if str(item.get('report_id')) == str(report_id):
        matched = item
        break

if not matched:
    sys.exit(f'report {report_id} not found in list response')

required_fields = ['report_id', 'region_id', 'year', 'active_version_id']
missing = [f for f in required_fields if f not in matched]
if missing:
    sys.exit(f'missing fields in list item: {missing}')

if matched.get('latest_job') is None or 'status' not in matched['latest_job']:
    sys.exit('latest_job missing or incomplete in list response')
print('[assert] report list contains required fields')
PY

echo "[reports] fetching detail for report ${REPORT_ID}"
DETAIL_RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/reports/${REPORT_ID}")
DETAIL_BODY=$(echo "${DETAIL_RESPONSE}" | sed '$d')
DETAIL_STATUS=$(echo "${DETAIL_RESPONSE}" | tail -n 1)

echo "detail_status=${DETAIL_STATUS} body=${DETAIL_BODY}"

if [[ "${DETAIL_STATUS}" != "200" ]]; then
  echo "[error] expected detail to return 200" >&2
  exit 1
fi

DETAIL_BODY="${DETAIL_BODY}" ${PYTHON_BIN} - <<'PY'
import json, os, sys
body = os.environ.get('DETAIL_BODY', '{}')
try:
    data = json.loads(body)
except Exception as exc:
    sys.exit(f'failed to parse detail response: {exc}')

required = ['report_id', 'region_id', 'year', 'active_version']
missing = [f for f in required if f not in data]
if missing:
    sys.exit(f'missing fields in detail response: {missing}')

active = data.get('active_version') or {}
active_required = ['version_id', 'file_hash', 'storage_path', 'parsed_json']
missing_active = [f for f in active_required if f not in active]
if missing_active:
    sys.exit(f'missing fields in active_version: {missing_active}')

latest_job = data.get('latest_job') or {}
job_required = ['job_id', 'status', 'progress', 'error_code', 'error_message']
missing_job = [f for f in job_required if f not in latest_job]
if missing_job:
    sys.exit(f'missing fields in latest_job: {missing_job}')

print('[assert] detail endpoint returned active version and latest job info')
PY

echo "[done] reports read API test passed"
