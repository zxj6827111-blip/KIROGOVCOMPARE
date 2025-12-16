#!/usr/bin/env bash

set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:3000}
SQLITE_DB_PATH=${SQLITE_DB_PATH:-data/llm_dev.db}

echo "[setup] preparing sqlite database at ${SQLITE_DB_PATH}"
mkdir -p "$(dirname "${SQLITE_DB_PATH}")"
sqlite3 "${SQLITE_DB_PATH}" < migrations/sqlite/001_llm_ingestion_schema.sql

echo "[setup] seeding region #1"
sqlite3 "${SQLITE_DB_PATH}" "INSERT OR IGNORE INTO regions (id, code, name, province) VALUES (1, 'demo', '演示地区', '演示省份')"

echo "[upload] first upload"
FIRST_RESPONSE=$(curl -s -w "\n%{http_code}" -F region_id=1 -F year=2023 -F file=@resources/sample-upload.pdf "${BASE_URL}/api/reports")
FIRST_BODY=$(echo "${FIRST_RESPONSE}" | head -n 1)
FIRST_STATUS=$(echo "${FIRST_RESPONSE}" | tail -n 1)
echo "status=${FIRST_STATUS} body=${FIRST_BODY}"

if [[ "${FIRST_STATUS}" != "201" ]]; then
  echo "[error] expected first upload to return 201"
  exit 1
fi

FIRST_FILE_HASH=$(FIRST_BODY="${FIRST_BODY}" python - <<'PY'
import json, os
body = os.environ.get('FIRST_BODY', '{}')
try:
    data = json.loads(body)
    print(data.get('file_hash', ''))
except Exception:
    print('')
PY
)
FIRST_REPORT_ID=$(FIRST_BODY="${FIRST_BODY}" python - <<'PY'
import json, os
body = os.environ.get('FIRST_BODY', '{}')
try:
    data = json.loads(body)
    print(data.get('report_id', ''))
except Exception:
    print('')
PY
)
if [[ -z "${FIRST_FILE_HASH}" || -z "${FIRST_REPORT_ID}" ]]; then
  echo "[error] failed to parse response body: ${FIRST_BODY}"
  exit 1
fi
EXPECTED_PATH="data/uploads/1/2023/${FIRST_FILE_HASH}.pdf"
if [[ ! -f "${EXPECTED_PATH}" ]]; then
  echo "[error] expected file at ${EXPECTED_PATH}"
  exit 1
fi

echo "[upload] duplicate upload"
SECOND_RESPONSE=$(curl -s -w "\n%{http_code}" -F region_id=1 -F year=2023 -F file=@resources/sample-upload.pdf "${BASE_URL}/api/reports")
SECOND_BODY=$(echo "${SECOND_RESPONSE}" | head -n 1)
SECOND_STATUS=$(echo "${SECOND_RESPONSE}" | tail -n 1)
echo "status=${SECOND_STATUS} body=${SECOND_BODY}"

if [[ "${SECOND_STATUS}" != "409" ]]; then
  echo "[error] expected duplicate upload to return 409"
  exit 1
fi

echo "[assert] reports table"
sqlite3 "${SQLITE_DB_PATH}" "SELECT id, region_id, year FROM reports;"

echo "[assert] report_versions table"
sqlite3 "${SQLITE_DB_PATH}" "SELECT id, report_id, file_hash, storage_path, is_active FROM report_versions;"

echo "[assert] active version count"
ACTIVE_COUNT=$(sqlite3 "${SQLITE_DB_PATH}" "SELECT COUNT(*) FROM report_versions WHERE report_id=${FIRST_REPORT_ID} AND is_active=1;")
if [[ "${ACTIVE_COUNT}" != "1" ]]; then
  echo "[error] expected exactly one active version per report (found ${ACTIVE_COUNT})"
  exit 1
fi

echo "[assert] jobs table"
sqlite3 "${SQLITE_DB_PATH}" "SELECT id, version_id, status FROM jobs;"

echo "[done] upload flow tested"
