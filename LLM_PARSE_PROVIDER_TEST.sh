#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000/api}"
UPLOAD_URL="$BASE_URL/reports"
JOB_URL_BASE="$BASE_URL/jobs"
PDF_PATH="${PDF_PATH:-resources/sample-upload.pdf}"
DB_PATH="${SQLITE_DB_PATH:-$(pwd)/data/llm_ingestion.db}"
PROVIDER_ENV="${LLM_PROVIDER:-}" # captured for logs only

PYTHON_BIN="python3"
command -v python3 >/dev/null 2>&1 || PYTHON_BIN="python"
command -v "$PYTHON_BIN" >/dev/null 2>&1 || { echo "python3/python is required" >&2; exit 1; }

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 command is required" >&2
  exit 1
fi

if [ ! -f "$PDF_PATH" ]; then
  echo "Sample PDF not found at $PDF_PATH" >&2
  exit 1
fi

echo "[notice] Ensure the running server uses SQLITE_DB_PATH=$DB_PATH to match this script"

provider_to_use="stub"
if [ "${GEMINI_API_KEY:-}" != "" ] && [ "${LLM_PROVIDER:-stub}" = "gemini" ]; then
  provider_to_use="gemini"
fi

echo "[info] Requested provider via env: ${PROVIDER_ENV:-unset}; resolved provider: $provider_to_use"

echo "[setup] ensuring sqlite schema at $DB_PATH"
mkdir -p "$(dirname "$DB_PATH")"
sqlite3 "$DB_PATH" < migrations/sqlite/001_llm_ingestion_schema.sql
if [ -f migrations/sqlite/002_report_version_parses.sql ]; then
  sqlite3 "$DB_PATH" < migrations/sqlite/002_report_version_parses.sql
fi

sqlite3 "$DB_PATH" "PRAGMA foreign_keys = ON; INSERT OR IGNORE INTO regions(id, code, name, province) VALUES (1, 'stub-region', 'Stub Region', 'Stub Province');"

run_upload_and_wait() {
  echo "[upload] uploading sample PDF with provider=$provider_to_use"
  UPLOAD_RESPONSE=$(curl -s -w "\n%{http_code}" -F "region_id=1" -F "year=2024" -F "file=@${PDF_PATH}" "$UPLOAD_URL")
  UPLOAD_BODY=$(echo "$UPLOAD_RESPONSE" | sed '$d')
  UPLOAD_STATUS=$(echo "$UPLOAD_RESPONSE" | tail -n 1)
  export UPLOAD_BODY

  if [ "$UPLOAD_STATUS" != "201" ] && [ "$UPLOAD_STATUS" != "409" ]; then
    echo "Unexpected upload status: $UPLOAD_STATUS body=$UPLOAD_BODY" >&2
    exit 1
  fi

  JOB_ID=$($PYTHON_BIN - <<'PY'
import json, os, sys
raw = os.environ.get('UPLOAD_BODY')
if not raw:
    sys.exit('missing upload response')
try:
    data = json.loads(raw)
except Exception:
    sys.exit('invalid json in upload response')
print(data.get('job_id'))
PY
)

  VERSION_ID=$($PYTHON_BIN - <<'PY'
import json, os, sys
raw = os.environ.get('UPLOAD_BODY')
if not raw:
    sys.exit('missing upload response')
try:
    data = json.loads(raw)
except Exception:
    sys.exit('invalid json in upload response')
print(data.get('version_id'))
PY
)

  if [ -z "$JOB_ID" ] || [ -z "$VERSION_ID" ]; then
    echo "Failed to parse job_id or version_id from upload response: $UPLOAD_BODY" >&2
    exit 1
  fi

  echo "[jobs] Created job $JOB_ID for version $VERSION_ID. Waiting for completion..."
  STATUS="queued"
  for attempt in $(seq 1 45); do
    JOB_RESPONSE=$(curl -s -w "\n%{http_code}" "$JOB_URL_BASE/$VERSION_ID")
    JOB_BODY=$(echo "$JOB_RESPONSE" | sed '$d')
    JOB_STATUS_CODE=$(echo "$JOB_RESPONSE" | tail -n 1)
    export JOB_BODY

    if [ "$JOB_STATUS_CODE" != "200" ]; then
      echo "Attempt $attempt: status code $JOB_STATUS_CODE"
      STATUS="unknown"
    else
      STATUS=$($PYTHON_BIN - <<'PY'
import json, os
try:
    resp = json.loads(os.environ.get('JOB_BODY', '{}'))
    print(resp.get('status', 'unknown'))
except Exception:
    print('unknown')
PY
      )
    fi

    echo "Attempt $attempt: status=$STATUS"

    if [ "$STATUS" = "succeeded" ]; then
      break
    fi

    if [ "$STATUS" = "failed" ]; then
      echo "Job failed early: $JOB_RESPONSE" >&2
      exit 1
    fi

    sleep 2
  done

  if [ "$STATUS" != "succeeded" ]; then
    echo "Job did not finish successfully within timeout" >&2
    exit 1
  fi

  echo "[assert] verifying parse record for version $VERSION_ID"
  PARSE_ROW=$(sqlite3 "$DB_PATH" "SELECT provider, model FROM report_version_parses WHERE report_version_id = $VERSION_ID ORDER BY id DESC LIMIT 1;")
  if [ -z "$PARSE_ROW" ]; then
    echo "Parse output not found for version $VERSION_ID" >&2
    exit 1
  fi

  PARSED_JSON=$(sqlite3 "$DB_PATH" "SELECT parsed_json FROM report_versions WHERE id = $VERSION_ID;")
  if [ -z "$PARSED_JSON" ]; then
    echo "parsed_json missing for version $VERSION_ID" >&2
    exit 1
  fi

  echo "[done] provider=$PARSE_ROW parsed_json_length=${#PARSED_JSON}"
}

if [ "$provider_to_use" = "gemini" ]; then
  echo "[mode] Running Gemini provider acceptance"
  run_upload_and_wait
else
  echo "[mode] GEMINI_API_KEY not provided or provider not set to gemini; using stub provider"
  run_upload_and_wait
fi
