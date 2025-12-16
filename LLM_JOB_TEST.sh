#!/usr/bin/env bash

set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:3000}
SQLITE_DB_PATH=${SQLITE_DB_PATH:-data/llm_dev.db}
UPLOAD_FILE=${UPLOAD_FILE:-resources/sample-upload.pdf}

echo "[setup] preparing sqlite database at ${SQLITE_DB_PATH}"
mkdir -p "$(dirname "${SQLITE_DB_PATH}")"
sqlite3 "${SQLITE_DB_PATH}" < migrations/sqlite/001_llm_ingestion_schema.sql

echo "[setup] seeding region #1"
sqlite3 "${SQLITE_DB_PATH}" "INSERT OR IGNORE INTO regions (id, code, name, province) VALUES (1, 'demo', '演示地区', '演示省份')"

echo "[upload] uploading sample report"
UPLOAD_RESPONSE=$(curl -s -w "\n%{http_code}" -F region_id=1 -F year=2023 -F file=@"${UPLOAD_FILE}" "${BASE_URL}/api/reports")
UPLOAD_BODY=$(echo "${UPLOAD_RESPONSE}" | head -n 1)
UPLOAD_STATUS=$(echo "${UPLOAD_RESPONSE}" | tail -n 1)
echo "status=${UPLOAD_STATUS} body=${UPLOAD_BODY}"

if [[ "${UPLOAD_STATUS}" != "201" && "${UPLOAD_STATUS}" != "409" ]]; then
  echo "[error] upload should return 201 or 409"
  exit 1
fi

REPORT_ID=$(UPLOAD_BODY="${UPLOAD_BODY}" python - <<'PY'
import json, os
body = os.environ.get('UPLOAD_BODY', '{}')
try:
    data = json.loads(body)
    print(data.get('report_id', ''))
except Exception:
    print('')
PY
)
VERSION_ID=$(UPLOAD_BODY="${UPLOAD_BODY}" python - <<'PY'
import json, os
body = os.environ.get('UPLOAD_BODY', '{}')
try:
    data = json.loads(body)
    print(data.get('version_id', ''))
except Exception:
    print('')
PY
)
JOB_ID=$(UPLOAD_BODY="${UPLOAD_BODY}" python - <<'PY'
import json, os
body = os.environ.get('UPLOAD_BODY', '{}')
try:
    data = json.loads(body)
    print(data.get('job_id', ''))
except Exception:
    print('')
PY
)

if [[ -z "${REPORT_ID}" || -z "${VERSION_ID}" || -z "${JOB_ID}" ]]; then
  echo "[error] missing report_id/version_id/job_id in upload response"
  exit 1
fi

echo "[jobs] fetching job ${JOB_ID}"
JOB_RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/jobs/${JOB_ID}")
JOB_BODY=$(echo "${JOB_RESPONSE}" | head -n 1)
JOB_STATUS=$(echo "${JOB_RESPONSE}" | tail -n 1)
echo "status=${JOB_STATUS} body=${JOB_BODY}"

if [[ "${JOB_STATUS}" != "200" ]]; then
  echo "[error] expected job fetch to return 200"
  exit 1
fi

JOB_BODY="${JOB_BODY}" python - <<'PY'
import json, os, sys
body = os.environ.get('JOB_BODY', '{}')
job = json.loads(body)
required = ['id', 'status', 'report_id', 'version_id', 'created_at', 'started_at', 'finished_at', 'error']
missing = [field for field in required if field not in job]
if missing:
    sys.stderr.write(f"[error] missing fields in job response: {missing}\n")
    sys.exit(1)
print(f"[assert] job fields present for job_id={job.get('id')}")
PY

for table in reports report_versions jobs; do
  echo "[assert] table ${table}"
  sqlite3 "${SQLITE_DB_PATH}" "SELECT * FROM ${table};"
done

echo "[done] upload + job lookup flow tested"
