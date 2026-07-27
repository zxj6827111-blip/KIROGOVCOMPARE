/**
 * Parse clipboard text from HTML/Excel tables into numeric cells.
 * Supports:
 * - horizontal: tab / multi-space / fullwidth-space / comma separated
 * - vertical: one number per line (common when copying from web pages)
 * Leading non-numeric label cells/lines are skipped.
 */

function normalizeToken(token) {
  return String(token || '')
    .replace(/,/g, '')
    .replace(/，/g, '')
    .replace(/[件次万元元%％]/g, '')
    .trim();
}

function tokenToNumber(token) {
  const cleaned = normalizeToken(token);
  if (cleaned === '' || cleaned === '-' || cleaned === '—' || cleaned === '/' || cleaned === '／') {
    return { kind: 'empty' };
  }
  if (/^[+-]?\d+(\.\d+)?$/.test(cleaned)) {
    return { kind: 'number', value: Number(cleaned) };
  }
  const m = cleaned.match(/^([+-]?\d+(?:\.\d+)?)/);
  if (m) {
    return { kind: 'number', value: Number(m[1]) };
  }
  return { kind: 'label' };
}

/** Extract ordered numbers from a single line of text. */
export function extractNumbersFromLine(line) {
  if (line == null) return [];
  const primary = String(line).trim();
  if (!primary) return [];

  let tokens = primary
    .split(/[\t,，;；|]+|\s{2,}|　+/g)
    .map((t) => t.trim())
    .filter((t) => t !== '');

  if (tokens.length < 2) {
    tokens = primary.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  }

  const numbers = [];
  for (const token of tokens) {
    const parsed = tokenToNumber(token);
    if (parsed.kind === 'empty') {
      numbers.push('');
      continue;
    }
    if (parsed.kind === 'number') {
      numbers.push(parsed.value);
      continue;
    }
    // Non-numeric label — skip only before any number is collected
    if (numbers.length === 0) continue;
  }
  return numbers;
}

/**
 * @param {string} text
 * @param {number} [expectedCount]
 * @returns {(number|string)[]}
 */
export function parsePastedNumbers(text, expectedCount) {
  if (text == null) return [];
  const raw = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!raw) return [];

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');

  if (lines.length === 0) return [];

  const perLine = lines.map((line) => extractNumbersFromLine(line));
  const multiValLineCount = perLine.filter((nums) => nums.length > 1).length;
  const singleValLineCount = perLine.filter((nums) => nums.length === 1).length;

  let numbers = [];

  // Vertical paste: one number (or empty placeholder) per line — typical web table column/row copy
  // e.g. "20551\n389\n0\n52\n34\n98\n21124"
  if (lines.length >= 2 && multiValLineCount === 0 && singleValLineCount >= 1) {
    for (let i = 0; i < lines.length; i += 1) {
      const nums = perLine[i];
      if (nums.length === 1) {
        numbers.push(nums[0]);
        continue;
      }
      // Pure label line (e.g. row title) — skip
      const parsed = tokenToNumber(lines[i]);
      if (parsed.kind === 'empty') {
        numbers.push('');
      }
      // labels ignored
    }
  } else if (lines.length >= 2 && multiValLineCount === 0) {
    // All labels? try whole text as one blob
    numbers = extractNumbersFromLine(raw.replace(/\n+/g, '\t'));
  } else {
    // Horizontal (or mixed): prefer the richest line, else flatten all
    const richest = perLine.reduce(
      (best, nums) => (nums.length > best.length ? nums : best),
      []
    );
    if (richest.length >= 2) {
      numbers = richest;
    } else {
      numbers = perLine.flat();
    }
  }

  if (typeof expectedCount === 'number' && expectedCount > 0) {
    return numbers.slice(0, expectedCount);
  }
  return numbers;
}

export function parseNumCell(value) {
  if (value === '' || value === null || value === undefined) return '';
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isNaN(n) ? '' : n;
}
