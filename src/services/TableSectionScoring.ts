/**
 * Candidate scoring for annual-report table sections (table_2 / table_3 / table_4).
 * Prefer strong field anchors + table density over first keyword hit.
 */

export type TableSectionId = 'table_2' | 'table_3' | 'table_4';

export interface TextWindowCandidate {
  startLine: number;
  endLine: number;
  titleLine: string;
  text: string;
  score: number;
  breakdown: Record<string, number>;
  reasons: string[];
}

const TABLE2_ANCHORS: Array<{ re: RegExp; w: number; tag: string }> = [
  { re: /第二十条第[（(][一1][）)]项/, w: 25, tag: 'art20_1' },
  { re: /第二十条第[（(][五5][）)]项/, w: 20, tag: 'art20_5' },
  { re: /第二十条第[（(][六6][）)]项/, w: 20, tag: 'art20_6' },
  { re: /第二十条第[（(][八8][）)]项/, w: 20, tag: 'art20_8' },
  { re: /本年制发件数/, w: 18, tag: 'made_label' },
  { re: /本年废止件数/, w: 18, tag: 'repealed_label' },
  { re: /现行有效件数/, w: 18, tag: 'valid_label' },
  { re: /本年处理决定数量/, w: 16, tag: 'processed_label' },
  { re: /本年收费金额/, w: 16, tag: 'fee_label' },
  { re: /行政规范性文件/, w: 12, tag: 'normative' },
  { re: /行政许可/, w: 10, tag: 'licensing' },
  { re: /行政处罚/, w: 10, tag: 'punishment' },
  { re: /行政强制/, w: 10, tag: 'coercion' },
  { re: /行政事业性收费/, w: 10, tag: 'fees' },
  { re: /##\s*表[二2]/i, w: 30, tag: 'md_table2' },
  { re: /表二[:：]/, w: 22, tag: 'table2_label' },
];

const TABLE3_ANCHORS: Array<{ re: RegExp; w: number; tag: string }> = [
  { re: /本列数据的勾稽关系/, w: 30, tag: 'crosscheck' },
  { re: /本年新收政府信息公开申请/, w: 22, tag: 'new_recv' },
  { re: /上年结转政府信息公开申请/, w: 20, tag: 'carry' },
  { re: /予以公开/, w: 12, tag: 'granted' },
  { re: /部分公开/, w: 12, tag: 'partial' },
  { re: /结转下年度/, w: 14, tag: 'carry_next' },
  { re: /申请人情况/, w: 12, tag: 'applicant' },
  { re: /##\s*表[三3]/i, w: 30, tag: 'md_table3' },
  { re: /表三[:：]/, w: 22, tag: 'table3_label' },
  { re: /收到和处理政府信息公开申请/, w: 18, tag: 'title_app' },
];

const TABLE4_ANCHORS: Array<{ re: RegExp; w: number; tag: string }> = [
  { re: /行政复议/, w: 16, tag: 'review' },
  { re: /行政诉讼/, w: 16, tag: 'litigation' },
  { re: /未经复议直接起诉/, w: 22, tag: 'direct' },
  { re: /复议后起诉/, w: 18, tag: 'post_review' },
  { re: /尚未审结/, w: 14, tag: 'unfinished' },
  { re: /##\s*表[四4]/i, w: 30, tag: 'md_table4' },
  { re: /表四[:：]/, w: 22, tag: 'table4_label' },
  { re: /结果维持|维持.*纠正/, w: 12, tag: 'maintain' },
];

const TITLE_HINTS: Record<TableSectionId, RegExp[]> = {
  table_2: [/主动公开/, /表[二2]/i, /第二十条/],
  table_3: [/申请/, /收到和处理/, /表[三3]/i],
  table_4: [/复议/, /诉讼/, /表[四4]/i],
};

/** Narrative-only active disclosure under overall situation — penalize as table_2. */
const TABLE2_NARRATIVE_PENALTY: RegExp[] = [
  /工作机制保障/,
  /主动公开工作情况/,
  /通过部门网站当年发布/,
];

function scoreAnchors(text: string, anchors: Array<{ re: RegExp; w: number; tag: string }>): {
  score: number;
  hits: string[];
} {
  let score = 0;
  const hits: string[] = [];
  for (const a of anchors) {
    if (a.re.test(text)) {
      score += a.w;
      hits.push(a.tag);
    }
  }
  return { score, hits };
}

function digitDensity(text: string): number {
  const digits = (text.match(/\d+/g) || []).length;
  const len = Math.max(text.length, 1);
  return Math.min(40, Math.round((digits / len) * 800));
}

function tableLayoutScore(text: string): number {
  let s = 0;
  if (/\|.+\|/.test(text)) s += 18;
  if ((text.match(/\|---/g) || []).length >= 1) s += 12;
  if ((text.match(/\n/g) || []).length >= 8) s += 6;
  return s;
}

/**
 * Find candidate windows starting at heading-like lines that match title hints,
 * each window extends until the next same-level numbered heading or N lines.
 */
export function collectTableSectionCandidates(
  fullText: string,
  tableId: TableSectionId,
  options?: { windowLines?: number }
): TextWindowCandidate[] {
  const windowLines = options?.windowLines ?? 80;
  const lines = String(fullText || '').split(/\n/);
  const anchors =
    tableId === 'table_2' ? TABLE2_ANCHORS : tableId === 'table_3' ? TABLE3_ANCHORS : TABLE4_ANCHORS;
  const titleHints = TITLE_HINTS[tableId];

  const startIndexes: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const looksHeading =
      /^#{0,6}\s*[一二三四五六]、/.test(line) ||
      /^##\s*表/.test(line) ||
      /^表[二三四234]/.test(line) ||
      titleHints.some((re) => re.test(line) && line.length < 80);
    if (!looksHeading) continue;
    if (!titleHints.some((re) => re.test(line)) && !/^##\s*表/.test(line) && !/^表[二三四234]/.test(line)) {
      // allow art20-only start for table2
      if (!(tableId === 'table_2' && /第二十条/.test(line))) continue;
    }
    startIndexes.push(i);
  }

  // Also start windows at strong anchor lines even without heading
  for (let i = 0; i < lines.length; i += 1) {
    if (tableId === 'table_2' && /第二十条第[（(][一1][）)]项|本年制发件数/.test(lines[i])) {
      startIndexes.push(Math.max(0, i - 2));
    }
    if (tableId === 'table_3' && /本列数据的勾稽关系|本年新收政府信息公开申请/.test(lines[i])) {
      startIndexes.push(Math.max(0, i - 2));
    }
    if (tableId === 'table_4' && /未经复议直接起诉|行政复议行政诉讼/.test(lines[i])) {
      startIndexes.push(Math.max(0, i - 2));
    }
  }

  const uniqueStarts = Array.from(new Set(startIndexes)).sort((a, b) => a - b);
  const candidates: TextWindowCandidate[] = [];

  for (const start of uniqueStarts) {
    let end = Math.min(lines.length, start + windowLines);
    for (let j = start + 1; j < end; j += 1) {
      const l = lines[j].trim();
      if (j > start + 3 && /^[一二三四五六]、/.test(l) && !titleHints.some((re) => re.test(l))) {
        // stop early only for unrelated top-level headings far enough
        if (tableId === 'table_2' && /申请|复议|诉讼|问题|其他/.test(l)) {
          end = j;
          break;
        }
        if (tableId === 'table_3' && /复议|诉讼|问题|其他|主动公开政府信息情况/.test(l) && !/申请/.test(l)) {
          end = j;
          break;
        }
        if (tableId === 'table_4' && (/主要问题|改进情况|其他需要报告/.test(l) || (/问题|其他|主动公开|申请情况/.test(l) && !/复议|诉讼/.test(l)))) {
          end = j;
          break;
        }
      }
    }
    const slice = lines.slice(start, end).join('\n');
    const titleLine = lines[start].trim();
    const { score: anchorScore, hits } = scoreAnchors(slice, anchors);
    let titleScore = 0;
    if (titleHints.some((re) => re.test(titleLine))) titleScore += 15;
    if (tableId === 'table_3' && /申请情况|收到和处理/.test(titleLine)) {
      titleScore += 25; /* title_app_boost */
    }
    if (tableId === 'table_4' && /复议|诉讼/.test(titleLine)) {
      titleScore += 25;
    }
    if (/##\s*表/.test(titleLine) || /^表[二三四]/.test(titleLine)) titleScore += 20;

    let penalty = 0;
    if (tableId === 'table_2') {
      for (const re of TABLE2_NARRATIVE_PENALTY) {
        if (re.test(titleLine) || (re.test(slice) && anchorScore < 40)) penalty += 25;
      }
      // "三、主动公开工作情况" narrative without art20
      if (/主动公开工作情况/.test(titleLine) && !/第二十条|本年制发/.test(slice)) penalty += 35;
      if (/工作机制保障/.test(titleLine)) penalty += 40;
    }
    if (tableId === 'table_3' && /政府信息公开申请情况/.test(titleLine) && !/本列数据的勾稽|本年新收/.test(slice)) {
      // overall-subtopic narrative about applications
      if (slice.length < 400 && !/\|/.test(slice)) penalty += 30;
    }

    const density = digitDensity(slice);
    const layout = tableLayoutScore(slice);
    const orderBonus = start > lines.length * 0.25 ? 8 : 0; // later in doc often real tables
    const score = Math.max(0, anchorScore + titleScore + density + layout + orderBonus - penalty);

    candidates.push({
      startLine: start + 1,
      endLine: end,
      titleLine,
      text: slice,
      score,
      breakdown: { anchorScore, titleScore, density, layout, orderBonus, penalty },
      reasons: hits,
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.startLine - b.startLine);
  return candidates;
}

export function selectBestTableSection(
  fullText: string,
  tableId: TableSectionId,
  options?: { minScore?: number; windowLines?: number }
): { selected: TextWindowCandidate | null; candidates: TextWindowCandidate[] } {
  const minScore = options?.minScore ?? (tableId === 'table_3' ? 20 : 35);
  const candidates = collectTableSectionCandidates(fullText, tableId, options);
  const selected = candidates.length > 0 && candidates[0].score >= minScore ? candidates[0] : null;
  return { selected, candidates };
}

/** Deterministic recovery of table_2 cells from markdown / labeled text (0 preserved). */
export function tryParseTable2FromSourceText(text: string): Record<string, any> | null {
  const t = String(text || '');
  if (!t.trim()) return null;

  const out: any = {
    regulations: { made: null, repealed: null, valid: null },
    normativeDocuments: { made: null, repealed: null, valid: null },
    licensing: { processed: null },
    punishment: { processed: null },
    coercion: { processed: null },
    fees: { amount: null },
  };

  const num = (s: string | undefined): number | null => {
    if (s === undefined || s === null) return null;
    const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  };

  // Markdown rows: | 规章 | 0 | 0 | 0 |
  const rowRe = /\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(t))) {
    const label = m[1].replace(/\s+/g, '');
    const a = num(m[2]);
    const b = num(m[3]);
    const c = num(m[4]);
    if (/规章/.test(label) && !/规范/.test(label)) {
      out.regulations = { made: a, repealed: b, valid: c };
    } else if (/规范性文件|规范文件/.test(label)) {
      out.normativeDocuments = { made: a, repealed: b, valid: c };
    }
  }

  // Labeled lines: 行政许可 97 / 本年处理决定数量
  const pickAfter = (label: RegExp): number | null => {
    const mm = t.match(new RegExp(label.source + '[^\\d]{0,12}(\\d+(?:\\.\\d+)?)', 'i'));
    return mm ? num(mm[1]) : null;
  };

  const lic = pickAfter(/行政许可|第二十条第[（(][五5][）)]项/);
  if (lic !== null) out.licensing.processed = lic;
  // Prefer number near 行政许可
  const licLine = t.match(/行政许可[^\n]{0,30}?(\d+)/);
  if (licLine) out.licensing.processed = num(licLine[1]);

  const pun = t.match(/行政处罚[^\n]{0,30}?(\d+)/);
  if (pun) out.punishment.processed = num(pun[1]);
  const coe = t.match(/行政强制[^\n]{0,30}?(\d+)/);
  if (coe) out.coercion.processed = num(coe[1]);
  const fee = t.match(/行政事业性收费[^\n]{0,40}?(\d+(?:\.\d+)?)/);
  if (fee) out.fees.amount = num(fee[1]);

  // If only narrative "规范性文件 13 件"
  if (out.normativeDocuments.made == null) {
    const n = t.match(/行政规范性文件\s*(\d+)\s*件/);
    if (n) out.normativeDocuments.made = num(n[1]);
  }

  const hasAny = [
    out.regulations.made,
    out.regulations.repealed,
    out.regulations.valid,
    out.normativeDocuments.made,
    out.normativeDocuments.repealed,
    out.normativeDocuments.valid,
    out.licensing.processed,
    out.punishment.processed,
    out.coercion.processed,
    out.fees.amount,
  ].some((v) => v !== null && v !== undefined);

  return hasAny ? out : null;
}
