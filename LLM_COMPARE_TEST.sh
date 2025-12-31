#!/usr/bin/env bash

set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:3000/api}
# 请确保 SQLITE_DB_PATH 与正在运行的服务保持一致，默认与 src/config/sqlite.ts 相同。
SQLITE_DB_PATH=${SQLITE_DB_PATH:-data/llm_ingestion.db}
LEFT_PDF=${LEFT_PDF:-tests/fixtures/a.pdf}
RIGHT_PDF=${RIGHT_PDF:-tests/fixtures/b.pdf}
REGION_ID=${REGION_ID:-1}
YEAR_A=${YEAR_A:-2023}
YEAR_B=${YEAR_B:-2024}

PYTHON_BIN=${PYTHON_BIN:-$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)}
if [ -z "${PYTHON_BIN}" ]; then
  echo "python3 或 python 未安装" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 command is required" >&2
  exit 1
fi

if [ ! -f "${LEFT_PDF}" ] || [ ! -f "${RIGHT_PDF}" ]; then
  echo "[error] fixture PDFs not found: ${LEFT_PDF} or ${RIGHT_PDF}" >&2
  exit 1
fi

mkdir -p "$(dirname "${SQLITE_DB_PATH}")"

echo "[setup] initializing sqlite schema at ${SQLITE_DB_PATH}" 
sqlite3 "${SQLITE_DB_PATH}" < migrations/sqlite/001_llm_ingestion_schema.sql
sqlite3 "${SQLITE_DB_PATH}" < migrations/sqlite/002_report_version_parses.sql
sqlite3 "${SQLITE_DB_PATH}" < migrations/sqlite/003_comparisons.sql

echo "[setup] seeding region #${REGION_ID}" 
sqlite3 "${SQLITE_DB_PATH}" "INSERT OR IGNORE INTO regions (id, code, name, province) VALUES (${REGION_ID}, 'demo-${REGION_ID}', '演示地区', '演示省份')"

upload_and_wait() {
  local year=$1
  local file=$2

  echo "[upload] uploading ${file} for year ${year}" 
  local upload_response
  upload_response=$(curl -s -w "\n%{http_code}" -F region_id=${REGION_ID} -F year=${year} -F file=@"${file}" "${BASE_URL}/reports")
  local body
  body=$(echo "${upload_response}" | head -n 1)
  local status
  status=$(echo "${upload_response}" | tail -n 1)
  echo "status=${status} body=${body}"

  if [[ "${status}" != "201" && "${status}" != "409" ]]; then
    echo "[error] upload should return 201 or 409" >&2
    exit 1
  fi

  local report_id version_id
  report_id=$(UPLOAD_BODY="${body}" ${PYTHON_BIN} - <<'PY'
import json, os
body = os.environ.get('UPLOAD_BODY', '{}')
try:
    data = json.loads(body)
    print(data.get('report_id', ''))
except Exception:
    print('')
PY
  )
  version_id=$(UPLOAD_BODY="${body}" ${PYTHON_BIN} - <<'PY'
import json, os
body = os.environ.get('UPLOAD_BODY', '{}')
try:
    data = json.loads(body)
    print(data.get('version_id', ''))
except Exception:
    print('')
PY
  )

  if [[ -z "${report_id}" || -z "${version_id}" ]]; then
    echo "[error] missing report_id or version_id in upload response" >&2
    exit 1
  fi

  echo "[jobs] polling version ${version_id} until succeeded" 
  local status_value="queued"
  for attempt in $(seq 1 30); do
    local job_response
    job_response=$(curl -s -w "\n%{http_code}" "${BASE_URL}/jobs/${version_id}")
    local job_body
    job_body=$(echo "${job_response}" | head -n 1)
    local job_status_code
    job_status_code=$(echo "${job_response}" | tail -n 1)

    if [[ "${job_status_code}" != "200" ]]; then
      echo "[error] expected job fetch to return 200, got ${job_status_code}" >&2
      exit 1
    fi

    status_value=$(JOB_BODY="${job_body}" ${PYTHON_BIN} - <<'PY'
import json, os
body = os.environ.get('JOB_BODY', '{}')
try:
    data = json.loads(body)
    print(data.get('status', ''))
except Exception:
    print('')
PY
    )

    echo "attempt=${attempt} status=${status_value}" 

    if [[ "${status_value}" == "succeeded" ]]; then
      break
    fi

    if [[ "${status_value}" == "failed" ]]; then
      echo "[error] job failed early: ${job_body}" >&2
      exit 1
    fi

    sleep 2
  done

  if [[ "${status_value}" != "succeeded" ]]; then
    echo "[error] job did not finish successfully" >&2
    exit 1
  fi

  echo "${report_id}"
}

LEFT_REPORT_ID=$(upload_and_wait "${YEAR_A}" "${LEFT_PDF}")
RIGHT_REPORT_ID=$(upload_and_wait "${YEAR_B}" "${RIGHT_PDF}")

if [[ -z "${LEFT_REPORT_ID}" || -z "${RIGHT_REPORT_ID}" ]]; then
  echo "[error] failed to get report ids" >&2
  exit 1
fi

echo "[compare] creating comparison for ${YEAR_A} vs ${YEAR_B}" 
COMPARE_RESPONSE=$(curl -s -w "\n%{http_code}" -H "Content-Type: application/json" -d "{\"region_id\":${REGION_ID},\"year_a\":${YEAR_A},\"year_b\":${YEAR_B}}" "${BASE_URL}/comparisons")
COMPARE_BODY=$(echo "${COMPARE_RESPONSE}" | head -n 1)
COMPARE_STATUS=$(echo "${COMPARE_RESPONSE}" | tail -n 1)

echo "status=${COMPARE_STATUS} body=${COMPARE_BODY}" 

if [[ "${COMPARE_STATUS}" != "201" && "${COMPARE_STATUS}" != "200" ]]; then
  echo "[error] creating comparison failed" >&2
  exit 1
fi

COMPARISON_ID=$(COMPARE_BODY="${COMPARE_BODY}" ${PYTHON_BIN} - <<'PY'
import json, os
body = os.environ.get('COMPARE_BODY', '{}')
try:
    data = json.loads(body)
    print(data.get('comparison_id', ''))
except Exception:
    print('')
PY
)
COMPARE_JOB_ID=$(COMPARE_BODY="${COMPARE_BODY}" ${PYTHON_BIN} - <<'PY'
import json, os
body = os.environ.get('COMPARE_BODY', '{}')
try:
    data = json.loads(body)
    print(data.get('job_id', ''))
except Exception:
    print('')
PY
)

if [[ -z "${COMPARISON_ID}" || -z "${COMPARE_JOB_ID}" ]]; then
  echo "[error] missing comparison_id or job_id" >&2
  exit 1
fi

STATUS_VALUE="queued"
echo "[jobs] polling comparison ${COMPARISON_ID} until succeeded" 
for attempt in $(seq 1 30); do
  JOB_RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/comparisons/${COMPARISON_ID}")
  JOB_BODY=$(echo "${JOB_RESPONSE}" | head -n 1)
  JOB_STATUS_CODE=$(echo "${JOB_RESPONSE}" | tail -n 1)

  if [[ "${JOB_STATUS_CODE}" != "200" ]]; then
    echo "[error] expected comparison fetch to return 200, got ${JOB_STATUS_CODE}" >&2
    exit 1
  fi

  STATUS_VALUE=$(JOB_BODY="${JOB_BODY}" ${PYTHON_BIN} - <<'PY'
import json, os
body = os.environ.get('JOB_BODY', '{}')
try:
    data = json.loads(body)
    latest_job = data.get('latest_job') or {}
    print(latest_job.get('status', 'queued'))
except Exception:
    print('')
PY
  )

  echo "attempt=${attempt} status=${STATUS_VALUE}" 

  if [[ "${STATUS_VALUE}" == "succeeded" ]]; then
    break
  fi

  if [[ "${STATUS_VALUE}" == "failed" ]]; then
    echo "[error] job failed early: ${JOB_BODY}" >&2
    exit 1
  fi

  sleep 2
 done

if [[ "${STATUS_VALUE}" != "succeeded" ]]; then
  echo "[error] compare job did not finish successfully" >&2
  exit 1
fi

echo "[compare] fetching comparison detail ${COMPARISON_ID}" 
DETAIL_RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/comparisons/${COMPARISON_ID}")
DETAIL_BODY=$(echo "${DETAIL_RESPONSE}" | head -n 1)
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

required = ['id', 'region_id', 'year_a', 'year_b', 'left_report_id', 'right_report_id', 'latest_job']
missing = [f for f in required if f not in data]
if missing:
    sys.exit(f'missing fields in detail response: {missing}')

latest_job = data.get('latest_job') or {}
for key in ['job_id', 'status']:
    if key not in latest_job:
        sys.exit(f'latest_job missing field: {key}')

diff_json = data.get('diff_json')
if diff_json is None:
    sys.exit('diff_json is missing from comparison detail')

if not isinstance(diff_json, dict):
    sys.exit('diff_json should be an object')

for key in ['added', 'removed', 'changed']:
    if key not in diff_json:
        sys.exit(f'diff_json missing {key}')

print('[assert] comparison detail contains diff_json with expected structure')
PY

echo "[success] compare flow completed"
echo "COMPARISON_ID=${COMPARISON_ID}"
