import fs from 'fs/promises';

type PdfJsModule = {
  getDocument: (options: Record<string, unknown>) => { promise: Promise<any> };
  OPS?: Record<string, number>;
};

let pdfjsPromise: Promise<PdfJsModule> | null = null;

function loadPdfjs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod: any) => mod.default || mod);
  }
  return pdfjsPromise;
}

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
    visual_border_missing?: boolean;
  };
  sections: PdfSection[];
  extracted_text: string;
}

export interface ParseResult {
  success: boolean;
  document?: PdfDocument;
  error?: string;
}

// Table region bounding box for border detection
interface TableRegion {
  pageNum: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  lineCount: number; // Number of table-like lines detected
}

// Stroke operation location info
interface StrokeLocation {
  pageNum: number;
  x: number;
  y: number;
}

type TextItem = {
  str: string;
  transform?: number[];
  width?: number;
};

// ... (existing helper functions isMostlyCjk, buildLineText, isHeadingLine, splitIntoSections)
// For brevity in this diff, I assume previous helper functions are kept or re-inserted.
// Since I am replacing the file content practically, I must re-include them.

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
    // Heuristic for width if missing
    const endX = x + (Number.isFinite(w) && w > 0 ? w : Math.max(0, s.length * 4));

    if (prevEndX !== null) {
      gaps.push(x - prevEndX);
    }
    parts.push(s);
    prevEndX = endX;
  }

  if (!parts.length) return '';

  const numericish = (t: string) => /^\d+(\.?\d+)?$/.test(t) || /^\d+(,\d{3})*(\.?\d+)?$/.test(t);
  const flatText = parts.join(' ');
  const tokens = flatText.split(/\s+/g).filter(Boolean);
  const numericCount = tokens.filter(numericish).length;
  const hasCountWords = /件数|合计|其中|万元|元|%/.test(flatText);
  // Avoid treating date ranges in narrative as tables
  const hasDateNarrative = /统计期限|期限从|日起至|截至/.test(flatText) && /年|月|日/.test(flatText);

  const colBreaks = gaps.filter((g) => g > 18).length;
  const tableLike = !hasDateNarrative && (colBreaks >= 2 || (colBreaks >= 1 && (hasCountWords || numericCount >= 3)));

  // Use Markdown table format for table-like content
  if (tableLike && parts.length >= 3) {
    // Format as Markdown table row
    return '| ' + parts.join(' | ') + ' |';
  }

  // Non-table content: join normally
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const gap = gaps[i - 1] ?? 0;
    if (gap > 1) {
      const sep = isMostlyCjk(parts[i - 1]) && isMostlyCjk(parts[i]) ? '' : ' ';
      out += sep + parts[i];
    } else {
      out += parts[i];
    }
  }

  return out.replace(/\s{2,}/g, ' ').trim();
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

  // Identify table type based on content
  const identifyTableType = (rows: string[][]): { type: string; title: string } | null => {
    const flatText = rows.map(r => r.join(' ')).join(' ').toLowerCase();

    // 表四：行政复议、行政诉讼
    if (flatText.includes('行政复议') || flatText.includes('行政诉讼')) {
      return { type: 'table_4', title: '## 表四：政府信息公开行政复议、行政诉讼情况' };
    }

    // 表三：申请情况
    if (flatText.includes('本年新收') || flatText.includes('上年结转') ||
      flatText.includes('予以公开') || flatText.includes('自然人')) {
      return { type: 'table_3', title: '## 表三：收到和处理政府信息公开申请情况' };
    }

    // 表二：主动公开
    if (flatText.includes('规章') || flatText.includes('规范性文件') ||
      flatText.includes('行政许可') || flatText.includes('行政处罚')) {
      return { type: 'table_2', title: '## 表二：主动公开政府信息情况' };
    }

    return null;
  };

  // Check if this is Table 4 (complex multi-header)
  const isTable4Complex = (rows: string[][]): boolean => {
    const flatText = rows.map(r => r.join(' ')).join(' ');
    return flatText.includes('行政复议') && flatText.includes('行政诉讼');
  };

  // Convert Table 4 to split format
  const convertTable4ToSplitFormat = (rows: string[][]): string => {
    let result = '\n## 表四：政府信息公开行政复议、行政诉讼情况\n\n';

    // Find data row (usually last row with mostly numbers)
    let dataRow: string[] = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      const numericCount = row.filter(c => /^\d+$/.test(c)).length;
      if (numericCount >= 5) {
        dataRow = row;
        break;
      }
    }

    if (dataRow.length >= 15) {
      const headers = ['结果维持', '结果纠正', '其他结果', '尚未审结', '总计'];

      result += '### 行政复议\n';
      result += '| ' + headers.join(' | ') + ' |\n';
      result += '|' + headers.map(() => '---').join('|') + '|\n';
      result += '| ' + dataRow.slice(0, 5).join(' | ') + ' |\n\n';

      result += '### 行政诉讼（未经复议直接起诉）\n';
      result += '| ' + headers.join(' | ') + ' |\n';
      result += '|' + headers.map(() => '---').join('|') + '|\n';
      result += '| ' + dataRow.slice(5, 10).join(' | ') + ' |\n\n';

      result += '### 行政诉讼（复议后起诉）\n';
      result += '| ' + headers.join(' | ') + ' |\n';
      result += '|' + headers.map(() => '---').join('|') + '|\n';
      result += '| ' + dataRow.slice(10, 15).join(' | ') + ' |\n';
    } else {
      // Fallback to normal format
      result += '| ' + rows[0]?.join(' | ') + ' |\n';
      result += '|' + (rows[0] || []).map(() => '---').join('|') + '|\n';
      for (let i = 1; i < rows.length; i++) {
        result += '| ' + rows[i].join(' | ') + ' |\n';
      }
    }

    return result;
  };

  const flushTable = () => {
    if (!tableBuf.length) return;
    const rows = tableBuf
      .map((row) => row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
      .filter((cells) => {
        if (cells.length < 2) return false;
        const isSeparator = cells.every((c) => c === '' || /^[-:\s]+$/.test(c));
        return !isSeparator;
      });
    if (!rows.length) {
      tableBuf = [];
      return;
    }

    // Check if this is Table 4 and needs special handling
    if (isTable4Complex(rows)) {
      const splitFormat = convertTable4ToSplitFormat(rows);
      current.content.push({ text: splitFormat });
    } else {
      const tableInfo = identifyTableType(rows);
      const maxCols = rows.reduce((acc, r) => Math.max(acc, r.length), 0);
      current.tables.push({
        title: tableInfo?.title || null,
        columns: maxCols,
        rows: rows.map((cells) => ({
          cells: Array.from({ length: maxCols }).map((_, idx) => ({ content: cells[idx] ?? '' })),
        })),
      });
    }
    tableBuf = [];
  };

  const flushParagraph = () => {
    if (!paragraphBuf.length) return;
    pushParagraph(paragraphBuf);
    paragraphBuf = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u00a0/g, ' ').trimEnd();
    // remove leading/trailing space
    const trimmed = line.trim();

    // Detect Markdown table row (starts and ends with |)
    const isMarkdownTableRow = /^\|.*\|$/.test(trimmed) && trimmed.split('|').length >= 3;
    // Also detect old format with | separators
    const isOldTableRow = !isMarkdownTableRow && trimmed.includes(' | ') && trimmed.split('|').length >= 3;
    const isTableRow = isMarkdownTableRow || isOldTableRow;
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
      // Normalize to Markdown format
      const normalizedRow = isMarkdownTableRow ? trimmed : '| ' + trimmed.split(' | ').join(' | ') + ' |';
      tableBuf.push(normalizedRow);
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

function buildMarkdownTable(table: PdfTable): string {
  const rows = table.rows.map((r) => r.cells.map((c) => c.content ?? ''));
  if (!rows.length) return '';
  let out = '| ' + rows[0].join(' | ') + ' |\n';
  out += '|' + rows[0].map(() => '---').join('|') + '|\n';
  for (let i = 1; i < rows.length; i++) {
    out += '| ' + rows[i].join(' | ') + ' |\n';
  }
  return out.trimEnd();
}

function buildExtractedTextFromSections(sections: PdfSection[]): string {
  const lines: string[] = [];
  for (const section of sections) {
    if (section.title) lines.push(section.title);
    for (const para of section.content) {
      if (para.text) lines.push(para.text);
    }
    for (const table of section.tables) {
      if (table.title) lines.push(table.title);
      const tableText = buildMarkdownTable(table);
      if (tableText) lines.push(tableText);
    }
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export class PdfParseService {
  buildMarkdownFromDocument(document: PdfDocument): string {
    if (!document) return '';
    const fromSections = buildExtractedTextFromSections(document.sections || []);
    return fromSections || document.extracted_text || '';
  }

  async parsePDFToMarkdown(filePath: string, assetId?: string): Promise<{
    success: boolean;
    markdown?: string;
    metadata?: PdfDocument['metadata'];
    error?: string;
    document?: PdfDocument;
  }> {
    const parsed = await this.parsePDF(filePath, assetId);
    if (!parsed.success || !parsed.document) {
      return { success: false, error: parsed.error };
    }

    const markdown = this.buildMarkdownFromDocument(parsed.document);
    return {
      success: true,
      markdown,
      metadata: parsed.document.metadata,
      document: parsed.document,
    };
  }

  async parsePDF(filePath: string, _assetId?: string): Promise<ParseResult> {
    try {
      const pdfjs = await loadPdfjs();
      const data = new Uint8Array(await fs.readFile(filePath));
      const loadingTask = pdfjs.getDocument({
        data,
        disableWorker: true,
        disableFontFace: true,
        isEvalSupported: false,
      });
      const pdf = await loadingTask.promise;

      const allLines: string[] = [];
      const tableRegions: TableRegion[] = [];
      const strokeLocations: StrokeLocation[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);

        // 1. Text Parsing - Identify table regions
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

        const lines: Array<{ y: number; items: any[]; isTableLike: boolean }> = [];
        const yTolerance = 2.5;
        for (const it of items) {
          const last = lines[lines.length - 1];
          if (!last || Math.abs((it.__y as number) - last.y) > yTolerance) {
            lines.push({ y: it.__y as number, items: [it], isTableLike: false });
          } else {
            last.items.push(it);
          }
        }

        // Detect table-like lines (lines with multiple columns/numbers)
        for (const l of lines) {
          const lineText = buildLineText(l.items);
          if (lineText) {
            allLines.push(lineText);
            // Check if this line looks like a table row
            const hasMultipleColumns = l.items.length >= 3;
            const numericCount = l.items.filter(it => /^\d+(\.\d+)?$/.test(String(it.str).trim())).length;
            l.isTableLike = hasMultipleColumns && numericCount >= 2;
          }
        }
        allLines.push(''); // Page break

        // Identify contiguous table regions
        let currentRegion: TableRegion | null = null;
        for (const line of lines) {
          if (line.isTableLike) {
            const lineMinX = Math.min(...line.items.map(it => it.__x as number));
            const lineMaxX = Math.max(...line.items.map(it => (it.__x as number) + (it.__w as number)));
            const lineMinY = line.y - 5;
            const lineMaxY = line.y + 5;

            if (!currentRegion) {
              currentRegion = {
                pageNum: i,
                minX: lineMinX,
                minY: lineMinY,
                maxX: lineMaxX,
                maxY: lineMaxY,
                lineCount: 1
              };
            } else {
              // Extend current region
              currentRegion.minX = Math.min(currentRegion.minX, lineMinX);
              currentRegion.minY = Math.min(currentRegion.minY, lineMinY);
              currentRegion.maxX = Math.max(currentRegion.maxX, lineMaxX);
              currentRegion.maxY = Math.max(currentRegion.maxY, lineMaxY);
              currentRegion.lineCount++;
            }
          } else if (currentRegion && currentRegion.lineCount >= 3) {
            // End of table region (need at least 3 lines to be considered a table)
            tableRegions.push(currentRegion);
            currentRegion = null;
          } else {
            currentRegion = null;
          }
        }

        // Push last region if exists
        if (currentRegion && currentRegion.lineCount >= 3) {
          tableRegions.push(currentRegion);
        }

        // 2. Parse stroke locations from operator list
        try {
          const ops = await page.getOperatorList();
          const OPS = pdfjs.OPS;
          if (OPS && ops.argsArray) {
            // Track current drawing position
            let currentX = 0;
            let currentY = 0;

            for (let idx = 0; idx < ops.fnArray.length; idx++) {
              const fn = ops.fnArray[idx];
              const args = ops.argsArray[idx];

              // moveTo: update position
              if (fn === OPS.moveTo && args && args.length >= 2) {
                currentX = args[0];
                currentY = args[1];
              }
              // lineTo: record line from current to args
              else if (fn === OPS.lineTo && args && args.length >= 2) {
                strokeLocations.push({ pageNum: i, x: currentX, y: currentY });
                strokeLocations.push({ pageNum: i, x: args[0], y: args[1] });
                currentX = args[0];
                currentY = args[1];
              }
              // stroke: mark as drawing
              else if (fn === OPS.stroke) {
                strokeLocations.push({ pageNum: i, x: currentX, y: currentY });
              }
              // rectangle: record all 4 corners
              else if (fn === OPS.rectangle && args && args.length >= 4) {
                const [x, y, w, h] = args;
                strokeLocations.push({ pageNum: i, x, y });
                strokeLocations.push({ pageNum: i, x: x + w, y });
                strokeLocations.push({ pageNum: i, x, y: y + h });
                strokeLocations.push({ pageNum: i, x: x + w, y: y + h });
              }
            }
          }
        } catch (e) {
          console.warn('Failed to get operator list for page', i, e);
        }
      }

      const sections = splitIntoSections(allLines);
      const reconstructedText = buildExtractedTextFromSections(sections);
      const extractedText = reconstructedText || allLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

      // Enhanced border detection: check if table regions have strokes
      let visual_border_missing = false;
      if (tableRegions.length > 0) {
        let strokesInTableRegions = 0;

        for (const region of tableRegions) {
          const strokesInThisRegion = strokeLocations.filter(stroke =>
            stroke.pageNum === region.pageNum &&
            stroke.x >= region.minX - 20 && stroke.x <= region.maxX + 20 &&
            stroke.y >= region.minY - 20 && stroke.y <= region.maxY + 20
          ).length;

          strokesInTableRegions += strokesInThisRegion;
        }

        // Heuristic: A table with N lines should have at least N*4 strokes (4 sides per cell row)
        const expectedStrokes = tableRegions.reduce((sum, r) => sum + r.lineCount, 0) * 4;
        const strokeRatio = strokesInTableRegions / Math.max(expectedStrokes, 1);

        console.log(`[PdfParseService] Table Regions: ${tableRegions.length}, Expected Strokes: ${expectedStrokes}, Actual: ${strokesInTableRegions}, Ratio: ${strokeRatio.toFixed(2)}`);

        // If stroke ratio < 0.5, likely missing borders
        if (strokeRatio < 0.5) {
          visual_border_missing = true;
        }
      }

      const document: PdfDocument = {
        title: undefined,
        metadata: {
          totalPages: pdf.numPages,
          visual_border_missing
        },
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
