#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_COMPARISON_IDS = [4670, 1143];

function parseArgs(argv) {
  const args = {
    comparisonIds: DEFAULT_COMPARISON_IDS,
    files: new Map(),
  };

  argv.forEach((arg) => {
    if (arg.startsWith('--comparison-ids=')) {
      args.comparisonIds = arg
        .slice('--comparison-ids='.length)
        .split(',')
        .map((item) => Number(item.trim()))
        .filter(Number.isFinite);
    } else if (arg.startsWith('--file=')) {
      const pair = arg.slice('--file='.length);
      const [idText, ...fileParts] = pair.split('=');
      const id = Number(idText);
      const filePath = fileParts.join('=');
      if (Number.isFinite(id) && filePath) {
        args.files.set(id, filePath);
      }
    }
  });

  return args;
}

async function loadPdfjs() {
  const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return mod.default || mod;
}

async function loadPool() {
  try {
    require('dotenv').config();
  } catch {
    // dotenv is optional for direct file checks.
  }
  return require('../dist/config/database-llm').default;
}

function normalizePath(value) {
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

async function resolvePdfFile(comparisonId, explicitFile) {
  if (explicitFile) return normalizePath(explicitFile);

  const pool = await loadPool();
  const result = await pool.query(
    `
      SELECT file_path
      FROM jobs
      WHERE kind = 'pdf_export'
        AND comparison_id = $1
        AND status = 'done'
        AND file_path IS NOT NULL
      ORDER BY finished_at DESC NULLS LAST, created_at DESC
      LIMIT 1
    `,
    [comparisonId]
  );
  return normalizePath(result.rows[0]?.file_path || '');
}

async function inspectPdf(pdfjs, filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = (textContent.items || [])
        .map((item) => String(item?.str || ''))
        .join('');
      pages.push(text);
    }
  } finally {
    await pdf.destroy?.();
  }

  const fullText = pages.join('\n');
  return {
    pageCount: pages.length,
    blankPages: pages.filter((text) => text.trim().length === 0).length,
    hasReplacementChar: fullText.includes('�'),
    printReadyMarkerOk:
      fullText.includes('比对报告') ||
      fullText.includes('政府信息公开') ||
      fullText.includes('年度报告') ||
      fullText.includes('对比'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pdfjs = await loadPdfjs();
  const results = [];
  let failed = false;

  for (const comparisonId of args.comparisonIds) {
    const filePath = await resolvePdfFile(comparisonId, args.files.get(comparisonId));
    const result = {
      comparisonId,
      filePath,
      exists: Boolean(filePath && fs.existsSync(filePath)),
      pageCount: 0,
      blankPages: 0,
      hasReplacementChar: false,
      printReadyMarkerOk: false,
      ok: false,
      error: '',
    };

    if (!result.exists) {
      result.error = 'PDF 文件不存在。请先生成 PDF，或用 --file=<comparison_id>=<pdf_path> 指定文件。';
      failed = true;
      results.push(result);
      continue;
    }

    try {
      const inspection = await inspectPdf(pdfjs, filePath);
      Object.assign(result, inspection);
      result.ok =
        result.pageCount > 0 &&
        result.blankPages === 0 &&
        !result.hasReplacementChar &&
        result.printReadyMarkerOk;
      if (!result.ok) failed = true;
    } catch (error) {
      result.error = error?.message || String(error);
      failed = true;
    }

    results.push(result);
  }

  console.log(JSON.stringify({ ok: !failed, results }, null, 2));
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

