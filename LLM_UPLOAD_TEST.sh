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

echo "[upload] duplicate upload"
SECOND_RESPONSE=$(curl -s -w "\n%{http_code}" -F region_id=1 -F year=2023 -F file=@resources/sample-upload.pdf "${BASE_URL}/api/reports")
SECOND_BODY=$(echo "${SECOND_RESPONSE}" | head -n 1)
SECOND_STATUS=$(echo "${SECOND_RESPONSE}" | tail -n 1)
echo "status=${SECOND_STATUS} body=${SECOND_BODY}"

echo "[assert] reports table"
sqlite3 "${SQLITE_DB_PATH}" "SELECT id, region_id, year FROM reports;"

echo "[assert] report_versions table"
sqlite3 "${SQLITE_DB_PATH}" "SELECT id, report_id, file_hash, storage_path FROM report_versions;"

echo "[assert] jobs table"
sqlite3 "${SQLITE_DB_PATH}" "SELECT id, version_id, status FROM jobs;"

echo "[done] upload flow tested"
