#!/usr/bin/env node
const fs = require('fs');

const controlCharRegex = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

function formatMatch(codePoint, index) {
  return `index=${index} U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

function collectMatches(content) {
  const matches = [];
  let result;
  while ((result = controlCharRegex.exec(content)) !== null) {
    matches.push({ index: result.index, codePoint: result[0].codePointAt(0) });
  }
  return matches;
}

function sanitizeFile(filePath, scanOnly = false) {
  const original = fs.readFileSync(filePath, 'utf8');
  const matches = collectMatches(original);

  if (scanOnly) {
    if (matches.length === 0) {
      console.log(`scan ok: ${filePath}`);
    } else {
      console.log(`scan found ${matches.length} control char(s) in ${filePath}: ${matches
        .map((m) => formatMatch(m.codePoint, m.index))
        .join(', ')}`);
    }
    return;
  }

  if (matches.length === 0) {
    console.log(`ok: ${filePath}`);
    return;
  }

  const cleaned = original.replace(controlCharRegex, '');
  fs.writeFileSync(filePath, cleaned, 'utf8');
  console.log(`cleaned ${filePath}; removed ${matches.length} control char(s)`);
}

function main() {
  const args = process.argv.slice(2);
  const scanOnly = args[0] === '--scan';
  const files = scanOnly ? args.slice(1) : args;

  if (files.length === 0) {
    console.error('Usage: node scripts/sanitize_unicode.js [--scan] <file1> [file2 ...]');
    process.exit(1);
  }

  files.forEach((file) => sanitizeFile(file, scanOnly));
}

main();
