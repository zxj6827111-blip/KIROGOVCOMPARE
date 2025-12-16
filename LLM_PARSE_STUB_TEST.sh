#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000/api}"
UPLOAD_URL="$BASE_URL/reports"
JOB_URL_BASE="$BASE_URL/jobs"
PDF_PATH="${PDF_PATH:-resources/sample-upload.pdf}"
DB_PATH="${SQLITE_DB_PATH:-$(pwd)/data/llm_dev.db}"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 command is required" >&2
  exit 1
fi

mkdir -p "$(dirname "$DB_PATH")"

if [ ! -f "$PDF_PATH" ]; then
  echo "Sample PDF not found at $PDF_PATH" >&2
  exit 1
fi

# Ensure a region exists for upload
sqlite3 "$DB_PATH" "PRAGMA foreign_keys = ON; INSERT OR IGNORE INTO regions(id, code, name, province) VALUES (1, 'stub-region', 'Stub Region', 'Stub Province');"

echo "Uploading sample PDF..."
UPLOAD_RESPONSE=$(curl -s -f -F "region_id=1" -F "year=2024" -F "file=@${PDF_PATH}" "$UPLOAD_URL")
export UPLOAD_RESPONSE

JOB_ID=$(python - <<'PY'
import json, os, sys
raw = os.environ.get('UPLOAD_RESPONSE')
if not raw:
    sys.exit('missing upload response')
data = json.loads(raw)
print(data.get('job_id'))
PY
)

VERSION_ID=$(python - <<'PY'
import json, os, sys
raw = os.environ.get('UPLOAD_RESPONSE')
if not raw:
    sys.exit('missing upload response')
data = json.loads(raw)
print(data.get('version_id'))
PY
)

if [ -z "$JOB_ID" ] || [ -z "$VERSION_ID" ]; then
  echo "Failed to parse job_id or version_id from upload response: $UPLOAD_RESPONSE" >&2
  exit 1
fi

echo "Created job $JOB_ID for version $VERSION_ID. Waiting for completion..."
STATUS="queued"
for attempt in $(seq 1 30); do
  JOB_RESPONSE=$(curl -s -f "$JOB_URL_BASE/$JOB_ID")
  export JOB_RESPONSE
  STATUS=$(python - <<'PY'
import json, os
resp = json.loads(os.environ.get('JOB_RESPONSE', '{}'))
print(resp.get('status', 'unknown'))
PY
)

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

PARSE_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM report_version_parses WHERE report_version_id = $VERSION_ID;")
if [ "${PARSE_COUNT:-0}" -lt 1 ]; then
  echo "Parse output not found for version $VERSION_ID" >&2
  exit 1
fi

echo "Parse records for version $VERSION_ID: $PARSE_COUNT"
echo "LLM parse stub test passed."
