import fs from 'fs/promises';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

const pdfjs = (pdfjsLib as any).default || pdfjsLib;

export interface PdfCell {
  content: string;
}

export interface PdfRow {
  cells: PdfCell[];
}

export interface PdfTable {
  title?: string | null;
  columns: number;
  rows: PdfRow[];
}

export interface PdfParagraph {
  text: string;
}

export interface PdfSection {
  title: string;
  content: PdfParagraph[];
  tables: PdfTable[];
}

export interface PdfDocument {
  title?: string;
  metadata: {
    totalPages: number;
  };
  sections: PdfSection[];
  extracted_text: string;
}

export interface ParseResult {
  success: boolean;
  document?: PdfDocument;
  error?: string;
}

type TextItem = {
  str: string;
  transform?: number[];
  width?: number;
};

function isMostlyCjk(s: string): boolean {
  const str = s.replace(/\s+/g, '');
  if (!str) return false;
  const cjk = (str.match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk / str.length >= 0.3;
}

function buildLineText(lineItems: Array<TextItem & { __x: number; __y: number; __w: number }>): string {
  const sorted = [...lineItems].sort((a, b) => a.__x - b.__x);
  const parts: string[] = [];
  const gaps: number[] = [];

  let prevEndX: number | null = null;
  for (const it of sorted) {
    const s = String(it.str || '').replace(/\s+/g, ' ').trim();
    if (!s) continue;

    const x = it.__x;
    const w = it.__w;
    const endX = x + (Number.isFinite(w) && w > 0 ? w : Math.max(0, s.length * 4));

    if (prevEndX !== null) {
      gaps.push(x - prevEndX);
    }
    parts.push(s);
    prevEndX = endX;
  }

  if (!parts.length) return '';

  const numericish = (t: string) => /^\d+(\.\d+)?$/.test(t) || /^\d+(,\d{3})*(\.\d+)?$/.test(t);
  const flatText = parts.join(' ');
  const tokens = flatText.split(/\s+/g).filter(Boolean);
  const numericCount = tokens.filter(numericish).length;
  const hasCountWords = /件数|合计|其中|万元|元|%/.test(flatText);
  const hasDateNarrative = /统计期限|期限从|日起至|截至/.test(flatText) && /年|月|日/.test(flatText);

  const colBreaks = gaps.filter((g) => g > 18).length;
  const tableLike = !hasDateNarrative && (colBreaks >= 2 || (colBreaks >= 1 && (hasCountWords || numericCount >= 3)));

  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const gap = gaps[i - 1] ?? 0;
    if (gap > 18 && tableLike) {
      out = out.trimEnd() + ' | ' + parts[i];
    } else if (gap > 1) {
      const sep = isMostlyCjk(parts[i - 1]) && isMostlyCjk(parts[i]) ? '' : ' ';
      out += sep + parts[i];
    } else {
      out += parts[i];
    }
  }

  return out.replace(/\s+\|\s+/g, ' | ').replace(/\s{2,}/g, ' ').trim();
}

function isHeadingLine(line: string): boolean {
  const s = line.trim();
  if (!s) return false;
  if (/^\s*[一二三四五六七八九十]+、\s*/.test(s)) return true;
  if (/^\s*\d+、\s*/.test(s)) return true;
  if (/^\s*第[一二三四五六七八九十\d]+章\s*/.test(s)) return true;
  if (/^\s*（[一二三四五六七八九十\d]+）\s*/.test(s)) return true;
  return false;
}

function splitIntoSections(lines: string[]): PdfSection[] {
  const sections: PdfSection[] = [];
  let current: PdfSection = { title: '正文', content: [], tables: [] };

  const flushSection = () => {
    const hasAny = current.content.length > 0 || current.tables.length > 0;
    if (hasAny) sections.push(current);
  };

  const pushParagraph = (buf: string[]) => {
    const text = buf.join('\n').trim();
    if (!text) return;
    current.content.push({ text });
  };

  let paragraphBuf: string[] = [];
  let tableBuf: string[] = [];

  const flushTable = () => {
    if (!tableBuf.length) return;
    const rows = tableBuf
      .map((row) => row.split('|').map((c) => c.trim()).filter(Boolean))
      .filter((cells) => cells.length >= 2);
    if (!rows.length) {
      tableBuf = [];
      return;
    }
    const maxCols = rows.reduce((acc, r) => Math.max(acc, r.length), 0);
    current.tables.push({
      title: null,
      columns: maxCols,
      rows: rows.map((cells) => ({
        cells: Array.from({ length: maxCols }).map((_, idx) => ({ content: cells[idx] ?? '' })),
      })),
    });
    tableBuf = [];
  };

  const flushParagraph = () => {
    if (!paragraphBuf.length) return;
    pushParagraph(paragraphBuf);
    paragraphBuf = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u00a0/g, ' ').trimEnd();
    const trimmed = line.trim();

    const isTableRow = trimmed.includes(' | ') && trimmed.split('|').length >= 3;
    const isBlank = trimmed === '';

    if (isHeadingLine(trimmed)) {
      flushTable();
      flushParagraph();
      flushSection();
      current = { title: trimmed, content: [], tables: [] };
      continue;
    }

    if (isBlank) {
      flushTable();
      flushParagraph();
      continue;
    }

    if (isTableRow) {
      flushParagraph();
      tableBuf.push(trimmed);
      continue;
    }

    flushTable();
    paragraphBuf.push(trimmed);
  }

  flushTable();
  flushParagraph();
  flushSection();
  return sections.length ? sections : [{ title: '正文', content: [], tables: [] }];
}

export class PdfParseService {
  async parsePDF(filePath: string, _assetId?: string): Promise<ParseResult> {
    try {
      const data = new Uint8Array(await fs.readFile(filePath));
      const loadingTask = pdfjs.getDocument({ data, disableWorker: true });
      const pdf = await loadingTask.promise;

      const allLines: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const items = (textContent.items as any[])
          .filter((it) => typeof it?.str === 'string' && String(it.str).trim() !== '')
          .map((it) => {
            const x = Number(it.transform?.[4] ?? 0);
            const y = Number(it.transform?.[5] ?? 0);
            const w = Number(it.width ?? 0);
            return { ...it, __x: x, __y: y, __w: w };
          })
          .sort((a, b) => {
            const yDiff = (b.__y as number) - (a.__y as number);
            if (Math.abs(yDiff) > 2) return yDiff;
            return (a.__x as number) - (b.__x as number);
          });

        const lines: Array<{ y: number; items: any[] }> = [];
        const yTolerance = 2.5;
        for (const it of items) {
          const last = lines[lines.length - 1];
          if (!last || Math.abs((it.__y as number) - last.y) > yTolerance) {
            lines.push({ y: it.__y as number, items: [it] });
          } else {
            last.items.push(it);
          }
        }

        for (const l of lines) {
          const lineText = buildLineText(l.items);
          if (lineText) allLines.push(lineText);
        }

        allLines.push('');
      }

      const extractedText = allLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      const sections = splitIntoSections(allLines);

      const document: PdfDocument = {
        title: undefined,
        metadata: { totalPages: pdf.numPages },
        sections,
        extracted_text: extractedText,
      };

      return { success: true, document };
    } catch (error: any) {
      return { success: false, error: error?.message || 'pdf_parse_failed' };
    }
  }
}

const pdfParseService = new PdfParseService();

export default pdfParseService;
