#!/usr/bin/env bash

set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:3000/api}
COMPARISON_ID=${COMPARISON_ID:-${1:-}}
OUTPUT_PATH=${OUTPUT_PATH:-comparison_export.docx}

PYTHON_BIN=${PYTHON_BIN:-$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)}
if [ -z "${PYTHON_BIN}" ]; then
  echo "python3 或 python 未安装" >&2
  exit 1
fi

if [ -z "${COMPARISON_ID}" ]; then
  echo "[error] COMPARISON_ID 未提供。请在环境变量或第一个参数中设置。" >&2
  exit 1
fi

TMP_DOCX="${OUTPUT_PATH}"

echo "[export] downloading comparison ${COMPARISON_ID} from ${BASE_URL}/comparisons/${COMPARISON_ID}/export"
RESPONSE_INFO=$(curl -s -w "\n%{http_code}" -o "${TMP_DOCX}" "${BASE_URL}/comparisons/${COMPARISON_ID}/export")
STATUS_CODE=$(echo "${RESPONSE_INFO}" | tail -n 1)

if [[ "${STATUS_CODE}" != "200" ]]; then
  echo "[error] export request failed with status ${STATUS_CODE}" >&2
  exit 1
fi

if [ ! -s "${TMP_DOCX}" ]; then
  echo "[error] 导出文件为空" >&2
  exit 1
fi

REQUIRED_DOCX_ENTRIES=${REQUIRED_DOCX_ENTRIES:-word/document.xml,[Content_Types].xml}
echo "[validate] checking docx archive entries"
PYTHON_BIN="${PYTHON_BIN}" REQUIRED_DOCX_ENTRIES="${REQUIRED_DOCX_ENTRIES}" node scripts/validate-docx-entries.js "${TMP_DOCX}"

echo "[success] export docx saved to ${TMP_DOCX}"
