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
    if (tableId === 'table_4' && (/##\s*表[四4]|表四[:：]|未经复议直接起诉|行政复议[、,，]?行政诉讼|政府信息公开行政复议/.test(lines[i]) && !/收到和处理|本年新收政府信息公开申请/.test(lines[i]))) {
      startIndexes.push(Math.max(0, i - 2));
    }
  }

  const uniqueStarts = Array.from(new Set(startIndexes)).sort((a, b) => a - b);
  const candidates: TextWindowCandidate[] = [];

  for (const start of uniqueStarts) {
    let end = Math.min(lines.length, start + windowLines);
    for (let j = start + 1; j < end; j += 1) {
      const l = lines[j].trim();
      if (j <= start + 2) continue;

      // Hard stop: table_3 must not cross into table_4 / review-litigation title
      if (
        tableId === 'table_3' &&
        (/^#{0,6}\s*表[四4]/.test(l) ||
          /^[一二三四五六]、.{0,40}(行政复议|行政诉讼)/.test(l) ||
          /^四、.{0,40}(行政复议|行政诉讼)/.test(l))
      ) {
        end = j;
        break;
      }

      // table_4 must end before problems/improvements body
      if (tableId === 'table_4') {
        if (
          /^[一二三四五六]、.{0,40}(主要问题|改进情况|其他需要报告)/.test(l) ||
          /^[（(][一二三四五六][）)].{0,40}(工作中存在问题|存在的主要问题|改进情况)/.test(l) ||
          (/(工作中存在问题的改进情况|工作中存在的主要问题|^[（(][一二三四五六][）)]\s*主要问题)/.test(l) && l.length < 80)
        ) {
          end = j;
          break;
        }
      }

      if (/^[一二三四五六]、/.test(l) && !titleHints.some((re) => re.test(l))) {
        if (tableId === 'table_2' && /申请|复议|诉讼|问题|其他/.test(l)) {
          end = j;
          break;
        }
        if (tableId === 'table_3' && /复议|诉讼|问题|其他|主动公开政府信息情况/.test(l) && !/申请/.test(l)) {
          end = j;
          break;
        }
        if (
          tableId === 'table_4' &&
          (/主要问题|改进情况|其他需要报告/.test(l) ||
            (/问题|其他|主动公开|申请情况/.test(l) && !/复议|诉讼/.test(l)))
        ) {
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
        if (tableId === 'table_4') {
      // table4 candidates must not start from table3 title region
      if (/表[三3]|收到和处理政府信息公开申请|本年新收政府信息公开申请/.test(titleLine)) {
        penalty += 50; /* table4_start_at_table3_penalty */
      }
      if (!/表[四4]|复议|诉讼|未经复议/.test(titleLine) && !/表[四4]|未经复议|行政复议/.test(slice.slice(0, 120))) {
        penalty += 20;
      }
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

  const num = (s: string | undefined | null): number | null => {
    if (s === undefined || s === null) return null;
    const raw = String(s).trim();
    if (!raw || /^[-–—:：]+$/.test(raw)) return null;
    const m = raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  };

  const isHeaderLabel = (label: string) =>
    /信息内容|本年制发|制发件数|废止件数|现行有效|^[-:]+$/.test(label);

  let regulationsFromFullRow = false;
  let normativeFromFullRow = false;

  // Line-based pipe rows (avoid catastrophic backtracking from global |...| scans)
  for (const rawLine of t.split(/\n/)) {
    const line = rawLine.trim();
    if (!line.includes('|')) continue;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c, idx, arr) => !(idx === 0 && c === '') && !(idx === arr.length - 1 && c === ''));
    // drop pure separator rows
    if (cells.length > 0 && cells.every((c) => /^[-:]+$/.test(c) || c === '')) continue;
    if (cells.length < 2) continue;

    const label = cells[0].replace(/\s+/g, '');
    if (isHeaderLabel(label)) continue;

    if (cells.length >= 4) {
      const a = num(cells[1]);
      const b = num(cells[2]);
      const c = num(cells[3]);
      if (a === null || b === null || c === null) {
        // fall through to 2-value if only two numbers present
      } else if (/规章/.test(label) && !/规范/.test(label)) {
        out.regulations = { made: a, repealed: b, valid: c };
        regulationsFromFullRow = true;
        continue;
      } else if (/行政规范性文件|规范性文件|规范文件/.test(label)) {
        out.normativeDocuments = { made: a, repealed: b, valid: c };
        normativeFromFullRow = true;
        continue;
      }
    }

    if (cells.length >= 3) {
      const a = num(cells[1]);
      const b = num(cells[2]);
      if (a === null || b === null) continue;
      if (/规章/.test(label) && !/规范/.test(label)) {
        if (!regulationsFromFullRow) {
          if (out.regulations.made == null) out.regulations.made = a;
          if (out.regulations.valid == null) out.regulations.valid = b;
        }
      } else if (/行政规范性文件|规范性文件|规范文件/.test(label)) {
        if (!normativeFromFullRow) {
          if (out.normativeDocuments.made == null) out.normativeDocuments.made = a;
          if (out.normativeDocuments.valid == null) out.normativeDocuments.valid = b;
        }
      }
    }
  }

  // Art.20(1) standalone line numbers fill MISSING middle (repealed) cells in column order:
  // 1st standalone → regulations.repealed, 2nd → normativeDocuments.repealed.
  const art1 = t.match(
    /第二十条第[（(][一1][）)]项([\s\S]{0,280}?)(?=第二十条第[（(][五5六6八8]|##\s*表|表二[:：]|信息内容本年处理|$)/
  );
  if (art1) {
    const lineNums: number[] = [];
    for (const line of art1[1].split(/\n/)) {
      const only = line.trim().match(/^(\d{1,4})\s*$/);
      if (only) lineNums.push(Number(only[1]));
    }

    // When 2-col rows already provided made+valid, standalone numbers fill repealed only.
    let fillIdx = 0;
    if (!regulationsFromFullRow && out.regulations.repealed == null && lineNums[fillIdx] != null) {
      if (out.regulations.made != null) {
        out.regulations.repealed = lineNums[fillIdx];
        fillIdx += 1;
      }
    }
    if (!normativeFromFullRow && out.normativeDocuments.repealed == null && lineNums[fillIdx] != null) {
      if (out.normativeDocuments.made != null || out.normativeDocuments.valid != null) {
        out.normativeDocuments.repealed = lineNums[fillIdx];
        fillIdx += 1;
      }
    }

    // Fallback only when no labeled table numbers at all
    if (
      !regulationsFromFullRow &&
      out.regulations.made == null &&
      out.regulations.valid == null &&
      lineNums.length >= 1
    ) {
      out.regulations.made = lineNums[0];
      if (lineNums.length >= 2) out.regulations.valid = lineNums[1];
    }
  }

  const licLine = t.match(/行政许可[^\n\d]{0,20}(\d+)/);
  if (licLine) out.licensing.processed = num(licLine[1]);
  const pun = t.match(/行政处罚[^\n\d]{0,20}(\d+)/);
  if (pun) out.punishment.processed = num(pun[1]);
  const coe = t.match(/行政强制[^\n\d]{0,20}(\d+)/);
  if (coe) out.coercion.processed = num(coe[1]);
  const fee = t.match(/行政事业性收费[^\n\d]{0,20}(\d+(?:\.\d+)?)/);
  if (fee) out.fees.amount = num(fee[1]);

  if (out.normativeDocuments.made == null) {
    const n = t.match(/行政规范性文件\s*(\d+)\s*件/);
    if (n) out.normativeDocuments.made = num(n[1]);
  }
  if (out.regulations.made == null) {
    const n = t.match(/(?:^|[\n|])\s*规章\s*(\d+)\s*件/);
    if (n) out.regulations.made = num(n[1]);
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
