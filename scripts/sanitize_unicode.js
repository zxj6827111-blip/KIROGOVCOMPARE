#!/usr/bin/env node
const fs = require('fs');

const controlCharRegex = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069\ufeff]/g;

function sanitizeFile(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  const cleaned = original.replace(controlCharRegex, '');
  if (original !== cleaned) {
    fs.writeFileSync(filePath, cleaned, 'utf8');
    console.log(`cleaned: ${filePath}`);
  } else {
    console.log(`ok: ${filePath}`);
  }
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: node scripts/sanitize_unicode.js <file1> [file2 ...]');
    process.exit(1);
  }

  files.forEach((file) => sanitizeFile(file));
}

main();
