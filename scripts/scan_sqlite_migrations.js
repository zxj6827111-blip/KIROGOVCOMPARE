const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations', 'sqlite');
const FORBIDDEN_KEYWORDS_PATH = path.join(__dirname, '..', 'migrations', 'sqlite_forbidden_keywords.json');

function loadForbiddenKeywords() {
  if (!fs.existsSync(FORBIDDEN_KEYWORDS_PATH)) {
    throw new Error(`[scan] Forbidden keywords file not found: ${FORBIDDEN_KEYWORDS_PATH}`);
  }
  const raw = fs.readFileSync(FORBIDDEN_KEYWORDS_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.keywords)) {
    throw new Error(`[scan] Invalid forbidden keywords format: ${FORBIDDEN_KEYWORDS_PATH}`);
  }
  return parsed.keywords.map((entry) => ({
    label: entry.label,
    pattern: new RegExp(entry.pattern, entry.flags || ''),
  }));
}

const FORBIDDEN = loadForbiddenKeywords();

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
