const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations', 'sqlite');

const FORBIDDEN = [
  { label: 'SERIAL', pattern: /\bSERIAL\b/i },
  { label: 'BIGSERIAL', pattern: /\bBIGSERIAL\b/i },
  { label: 'UUID', pattern: /\bUUID\b/i },
  { label: 'JSONB', pattern: /\bJSONB\b/i },
  { label: 'JSON', pattern: /\bJSON\b/i },
  { label: 'TIMESTAMP', pattern: /\bTIMESTAMP\b/i },
  { label: 'TIMESTAMPTZ', pattern: /\bTIMESTAMPTZ\b/i },
  { label: 'CURRENT_TIMESTAMP', pattern: /\bCURRENT_TIMESTAMP\b/i },
];

function stripComments(sql) {
  let cleaned = sql.replace(/--.*$/gm, '');
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ''));
  return cleaned;
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const stripped = stripComments(content);
  const lines = stripped.split('\n');
  const hits = [];

  lines.forEach((line, index) => {
    FORBIDDEN.forEach(({ label, pattern }) => {
      if (pattern.test(line)) {
        hits.push({ line: index + 1, label });
      }
    });
  });

  return hits;
}

function main() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log(`[scan] sqlite migrations directory not found: ${MIGRATIONS_DIR}`);
    return;
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const violations = [];

  files.forEach((file) => {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const hits = scanFile(filePath);
    hits.forEach((hit) => {
      violations.push({ file: filePath, line: hit.line, label: hit.label });
    });
  });

  if (violations.length > 0) {
    console.error('[scan] Forbidden SQLite migration keywords detected:');
    violations.forEach((v) => {
      console.error(`- ${v.file}:${v.line} contains ${v.label}`);
    });
    process.exit(1);
  }

  console.log('[scan] SQLite migrations keyword check passed');
}

main();
