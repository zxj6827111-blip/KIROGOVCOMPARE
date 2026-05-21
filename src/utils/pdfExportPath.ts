import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config/constants';

export const DEFAULT_PDF_EXPORTS_DIR = path.resolve(DATA_DIR, 'exports', 'pdf');

const normalizeForCompare = (value: string): string =>
  process.platform === 'win32' ? value.toLowerCase() : value;

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of paths) {
    const resolved = path.resolve(item);
    const key = normalizeForCompare(resolved);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(resolved);
    }
  }

  return result;
}

export function getPdfExportRoots(): string[] {
  const roots = [DEFAULT_PDF_EXPORTS_DIR];

  if (process.env.DATA_DIR) {
    roots.push(path.resolve(process.env.DATA_DIR, 'exports', 'pdf'));
  }

  return uniquePaths(roots);
}

export function ensurePdfExportsDir(root: string = DEFAULT_PDF_EXPORTS_DIR): void {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot)) {
    fs.mkdirSync(resolvedRoot, { recursive: true });
  }
}

export function sanitizePdfExportFileName(value: unknown, fallback = 'comparison.pdf'): string {
  const raw = String(value || fallback).trim() || fallback;
  const baseName = path.basename(raw).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  const withoutControlChars = baseName.replace(/[\u0000-\u001f\u007f]/g, '_');
  const capped = withoutControlChars.slice(0, 180).trim() || fallback;
  return capped.toLowerCase().endsWith('.pdf') ? capped : `${capped}.pdf`;
}

export function buildPdfExportPath(fileName: unknown, root: string = DEFAULT_PDF_EXPORTS_DIR): string {
  const resolvedRoot = path.resolve(root);
  const safeFileName = sanitizePdfExportFileName(fileName);
  const resolvedFilePath = path.resolve(resolvedRoot, safeFileName);

  if (!isPathInsideAnyPdfExportRoot(resolvedFilePath, [resolvedRoot])) {
    throw new Error('invalid_pdf_export_file_path');
  }

  return resolvedFilePath;
}

export function isPathInsideAnyPdfExportRoot(filePath: unknown, roots: string[] = getPdfExportRoots()): boolean {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return false;
  }

  const resolvedPath = path.resolve(filePath);
  return roots.some((root) => {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolvedPath);
    const normalizedRelative = normalizeForCompare(relative);
    return (
      relative === '' ||
      (!normalizedRelative.startsWith('..') && !path.isAbsolute(relative))
    );
  });
}

export function resolvePdfExportFilePath(filePath: unknown): string | null {
  if (!isPathInsideAnyPdfExportRoot(filePath)) {
    return null;
  }

  return path.resolve(String(filePath));
}
