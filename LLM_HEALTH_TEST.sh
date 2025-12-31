#!/usr/bin/env bash

set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:3000/api}
HEALTH_URL="${BASE_URL%/}/health"

PYTHON_BIN=${PYTHON_BIN:-$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)}
if [ -z "${PYTHON_BIN}" ]; then
  echo "python3 or python is required" >&2
  exit 1
fi

if command -v curl >/dev/null 2>&1; then
  CURL_BIN="curl"
elif command -v curl.exe >/dev/null 2>&1; then
  CURL_BIN="curl.exe"
else
  echo "curl is required (curl or curl.exe)" >&2
  exit 1
fi

echo "[health] checking ${HEALTH_URL}"
if ! HEALTH_RESPONSE=$(${CURL_BIN} -s -w "\n%{http_code}" "${HEALTH_URL}"); then
  echo "[error] request failed" >&2
  exit 1
fi

BODY=$(echo "${HEALTH_RESPONSE}" | sed '$d')
STATUS_CODE=$(echo "${HEALTH_RESPONSE}" | tail -n 1)

echo "status=${STATUS_CODE} body=${BODY}"

if [ "${STATUS_CODE}" != "200" ]; then
  echo "[error] expected HTTP 200" >&2
  exit 1
fi

STATUS_VALUE=$(BODY="${BODY}" ${PYTHON_BIN} - <<'PY'
import json, os, sys
raw = os.environ.get('BODY', '')
try:
    data = json.loads(raw)
except Exception as exc:
    sys.exit(f'failed to parse health response: {exc}')

value = str(data.get('status', '')).lower()
if value not in {'ok', 'healthy'}:
    sys.exit(f'unexpected status field: {value}')
print(value)
PY
)

echo "[assert] health status=${STATUS_VALUE}"
echo "[success] health endpoint is reachable"
