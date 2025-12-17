#!/usr/bin/env node

const { existsSync } = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const docxPath = process.argv[2];
if (!docxPath) {
  console.error('[usage] node scripts/validate-docx-entries.js <docx-path>');
  process.exit(2);
}

const resolvedDocx = path.resolve(docxPath);
if (!existsSync(resolvedDocx)) {
  console.error(`[error] file not found: ${resolvedDocx}`);
  process.exit(2);
}

const requiredEntries = (process.env.REQUIRED_DOCX_ENTRIES || 'word/document.xml,[Content_Types].xml')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const pythonCandidates = [process.env.PYTHON_BIN, 'python3', 'python'].filter(Boolean);
const pythonCode = `
import sys
import zipfile
from pathlib import Path

docx_path = Path(sys.argv[1])
required = [item for item in sys.argv[2].split(',') if item]
try:
    with zipfile.ZipFile(docx_path, 'r') as zf:
        names = set(zf.namelist())
        test_error = zf.testzip()
        if test_error:
            sys.exit(f'zip CRC failed on {test_error}')
except Exception as exc:
    sys.exit(f'failed to open {docx_path}: {exc}')

missing = set(required) - names
if missing:
    sys.exit('missing entries: ' + ', '.join(sorted(missing)))

print('[assert] docx archive is valid')
`;

let lastStatus = 1;
for (const pythonBin of pythonCandidates) {
  const result = spawnSync(pythonBin, ['-c', pythonCode, resolvedDocx, requiredEntries.join(',')], {
    stdio: 'inherit',
  });

  if (result.status === 0) {
    process.exit(0);
  }

  lastStatus = result.status ?? 1;
}

console.error('[error] docx validation failed (python not available or invalid file)');
process.exit(lastStatus);
