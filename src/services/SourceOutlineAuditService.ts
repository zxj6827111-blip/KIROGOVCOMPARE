import { estimatePageFromLine } from '../utils/structuredFieldMerge';
/**
 * Pre-parse audit of annual-report source outline / titles / text quality.
 * Does NOT modify source text — only emits issues + raw_source_outline.
 */

export type OutlineCandidateRole =
  | 'statutory_section'
  | 'overall_subtopic'
  | 'table_section'
  | 'table_internal_heading'
  | 'ordinary_heading'
  | 'unknown';

export type IssueClass = 'source_format' | 'source_content' | 'extraction' | 'consistency';
export type IssueResponsibility = 'source' | 'system' | 'mixed';
export type IssueSeverity = 'error' | 'warning' | 'info';

export interface RawOutlineHeading {
  raw_title: string;
  page: number | null;
  line: number;
  ordinal: string | null;
  semantic_type: string | null;
  candidate_role: OutlineCandidateRole;
  source_excerpt: string;
  confidence: number;
}

export interface SourceAuditIssue {
  check_key: string;
  issue_class: IssueClass;
  responsibility: IssueResponsibility;
  severity: IssueSeverity;
  group_key: string;
  title: string;
  message: string;
  source_page: number | null;
  source_excerpt: string;
  raw_title?: string | null;
  canonical_title?: string | null;
  expected_value?: string | null;
  actual_value?: string | null;
  evidence_json?: Record<string, unknown>;
  needs_human_review: boolean;
}

export interface SourceOutlineAuditResult {
  raw_source_outline: RawOutlineHeading[];
  issues: SourceAuditIssue[];
  has_multiple_numbering_systems: boolean;
  overall_subtopics_as_top_level: boolean;
}

const STATUTORY: Array<{ key: string; title: string; patterns: RegExp[] }> = [
  { key: 'overall', title: '一、总体情况', patterns: [/总体情况/] },
  {
    key: 'active_disclosure',
    title: '二、主动公开政府信息情况',
    patterns: [/主动公开政府信息情况/, /##\s*表[二2]/i, /第二十条第/],
  },
  {
    key: 'application',
    title: '三、收到和处理政府信息公开申请情况',
    patterns: [/收到和处理政府信息公开申请/, /##\s*表[三3]/i, /本列数据的勾稽关系/],
  },
  {
    key: 'review_litigation',
    title: '四、政府信息公开行政复议、行政诉讼情况',
    patterns: [/行政复议.*行政诉讼|行政诉讼情况/, /##\s*表[四4]/i, /未经复议直接起诉/],
  },
  {
    key: 'problems',
    title: '五、存在的主要问题及改进情况',
    patterns: [/主要问题及改进|存在的主要问题|改进情况/],
  },
  {
    key: 'other',
    title: '六、其他需要报告的事项',
    patterns: [/其他需要报告的事项/],
  },
];

const OVERALL_SUBTOPIC: Array<{ re: RegExp; semantic: string }> = [
  { re: /工作机制保障/, semantic: 'overall_mechanism' },
  { re: /主动公开工作情况|主动公开方面/, semantic: 'overall_active_disclosure' },
  { re: /政府信息公开申请情况|依申请公开方面/, semantic: 'overall_application' },
  { re: /政府信息管理/, semantic: 'overall_info_mgmt' },
  { re: /政府信息公开平台建设|平台建设/, semantic: 'overall_platform' },
  { re: /监督保障/, semantic: 'overall_supervision' },
];

function extractOrdinal(title: string): string | null {
  const m = title.match(/^#{0,6}\s*([一二三四五六七八九十])、/);
  return m ? m[1] : null;
}

function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 80) return false;
  if (/^#{0,6}\s*[一二三四五六]、/.test(t)) return true;
  if (/^##\s*表[二三四234]/.test(t)) return true;
  if (/^（[一二三四五]）/.test(t) && t.length < 40) return true;
  return false;
}

function classifyHeading(title: string): Omit<RawOutlineHeading, 'line' | 'page' | 'source_excerpt'> {
  const raw = title.trim();
  const ordinal = extractOrdinal(raw);

  if (/##\s*表[二2]|表二[:：]/.test(raw)) {
    return {
      raw_title: raw,
      ordinal,
      semantic_type: 'table_2',
      candidate_role: 'table_section',
      confidence: 0.95,
    };
  }
  if (/##\s*表[三3]|表三[:：]/.test(raw)) {
    return {
      raw_title: raw,
      ordinal,
      semantic_type: 'table_3',
      candidate_role: 'table_section',
      confidence: 0.95,
    };
  }
  if (/##\s*表[四4]|表四[:：]/.test(raw)) {
    return {
      raw_title: raw,
      ordinal,
      semantic_type: 'table_4',
      candidate_role: 'table_section',
      confidence: 0.95,
    };
  }

  for (const s of STATUTORY) {
    if (s.patterns.some((p) => p.test(raw))) {
      // statutory if looks like real section titles
      const isStatutoryShape =
        /主动公开政府信息情况|收到和处理|行政复议|主要问题|其他需要报告|总体情况/.test(raw) ||
        /第二十条|本列数据的勾稽/.test(raw);
      if (isStatutoryShape || s.key === 'overall') {
        return {
          raw_title: raw,
          ordinal,
          semantic_type: s.key,
          candidate_role: 'statutory_section',
          confidence: 0.9,
        };
      }
    }
  }

  for (const o of OVERALL_SUBTOPIC) {
    if (o.re.test(raw) && ordinal) {
      return {
        raw_title: raw,
        ordinal,
        semantic_type: o.semantic,
        candidate_role: 'overall_subtopic',
        confidence: 0.92,
      };
    }
  }

  if (/^（[一二三四五]）/.test(raw)) {
    return {
      raw_title: raw,
      ordinal: null,
      semantic_type: 'parenthetical_sub',
      candidate_role: 'ordinary_heading',
      confidence: 0.7,
    };
  }

  if (ordinal) {
    return {
      raw_title: raw,
      ordinal,
      semantic_type: null,
      candidate_role: 'unknown',
      confidence: 0.5,
    };
  }

  return {
    raw_title: raw,
    ordinal: null,
    semantic_type: null,
    candidate_role: 'ordinary_heading',
    confidence: 0.4,
  };
}


/** Generic text quality patterns. Unit-specific fixtures must not be required for production. */
const TEXT_QUALITY_LEXICON: Array<{
  id: string;
  re: RegExp;
  check_key: string;
  title: string;
  message: string;
  severity: IssueSeverity;
}> = [
  {
    id: 'dup_word_generic',
    re: /([\u4e00-\u9fff]{2,8})\1/,
    check_key: 'SRC_TEXT_DUPLICATED_WORD',
    title: '疑似用词重复',
    message: '正文出现连续重复的中文词组，请人工核对是否笔误。',
    severity: 'warning',
  },
  {
    id: 'incomplete_guan',
    re: /审查管(?!理)/,
    check_key: 'SRC_TEXT_INCOMPLETE_SENTENCE',
    title: '疑似残句（审查管）',
    message: '出现“审查管”且未接“理”，疑似残句（通用词库，非单文件硬编码逻辑入口）。',
    severity: 'warning',
  },
  {
    id: 'suspicious_sheji',
    re: /重新涉及部门网站/,
    check_key: 'SRC_TEXT_SUSPICIOUS_WORDING',
    title: '疑似用词错误（重新涉及部门网站）',
    message: '“重新涉及部门网站”在政务公开语境下疑似应为“重新设计…”，请人工确认。',
    severity: 'warning',
  },
  {
    id: 'en_comma_liufen',
    re: /六部分,/,
    check_key: 'SRC_TEXT_PUNCTUATION',
    title: '标点不规范（英文逗号）',
    message: '“六部分,”使用了英文逗号，建议使用中文标点。',
    severity: 'info',
  },
];

function loadExtraTextLexicon(): typeof TEXT_QUALITY_LEXICON {
  // Optional JSON: [{ "id","pattern","check_key","title","message","severity" }]
  const rawEnv = process.env.SOURCE_TEXT_QUALITY_LEXICON_JSON;
  if (!rawEnv) return [];
  try {
    const arr = JSON.parse(rawEnv);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((item: any) => ({
        id: String(item.id || 'extra'),
        re: new RegExp(String(item.pattern || ''), 'g'),
        check_key: String(item.check_key || 'SRC_TEXT_SUSPICIOUS_WORDING'),
        title: String(item.title || '文字质量问题'),
        message: String(item.message || ''),
        severity: (item.severity || 'warning') as IssueSeverity,
      }))
      .filter((x: any) => x.re.source);
  } catch {
    return [];
  }
}

function issue(
  partial: Omit<SourceAuditIssue, 'needs_human_review'> & { needs_human_review?: boolean }
): SourceAuditIssue {
  return {
    needs_human_review: partial.needs_human_review ?? partial.severity !== 'info',
    ...partial,
  };
}

export function auditSourceOutline(sourceText: string): SourceOutlineAuditResult {
  const lines = String(sourceText || '').split(/\n/);
  const outline: RawOutlineHeading[] = [];

  lines.forEach((line, idx) => {
    if (!isHeadingLine(line)) return;
    const classified = classifyHeading(line);
    outline.push({
      ...classified,
      line: idx + 1,
      page: estimatePageFromLine(String(sourceText || ''), idx + 1),
      source_excerpt: line.trim().slice(0, 200),
    });
  });

  const issues: SourceAuditIssue[] = [];
  const topLevel = outline.filter((h) => /^[一二三四五六]、/.test(h.raw_title.replace(/^#+\s*/, '')));
  const overallSubs = outline.filter((h) => h.candidate_role === 'overall_subtopic');
  const statutory = outline.filter((h) => h.candidate_role === 'statutory_section');

  // Multiple numbering systems: many top-level ordinals that restart (一 appears twice as top)
  const topOrdinals = topLevel.map((h) => h.ordinal).filter(Boolean) as string[];
  const firstYi = topOrdinals.indexOf('一');
  const secondYi = topOrdinals.indexOf('一', firstYi + 1);
  const hasMultiple = secondYi > firstYi && firstYi >= 0;
  if (hasMultiple) {
    issues.push(
      issue({
        check_key: 'SRC_MULTIPLE_NUMBERING_SYSTEMS',
        issue_class: 'source_format',
        responsibility: 'source',
        severity: 'error',
        group_key: 'section',
        title: '源文件存在多套顶级章节编号体系',
        message:
          '正文中“一、”等顶级编号出现重启，疑似将“总体情况”内部事项与法定六部分混用两套编号，不符合规范年报结构。',
        source_page: null,
        source_excerpt: topLevel
          .slice(0, 12)
          .map((h) => h.raw_title)
          .join('；'),
        evidence_json: { top_level_titles: topLevel.map((h) => h.raw_title) },
      })
    );
  }

  if (overallSubs.length >= 2) {
    issues.push(
      issue({
        check_key: 'SRC_OVERALL_SUBTOPIC_AS_TOP_LEVEL',
        issue_class: 'source_format',
        responsibility: 'source',
        severity: 'error',
        group_key: 'section',
        title: '总体情况内部子栏目误用顶级章节编号',
        message:
          '检测到多个更像“总体情况”工作方面的标题使用了“一、二、三…”顶级编号（如工作机制保障、主动公开工作情况、信息管理、平台建设等），规范上这些应作为总体情况的子栏目，而非新的法定顶级章节。',
        source_page: null,
        source_excerpt: overallSubs.map((h) => h.raw_title).join('；'),
        canonical_title: '一、总体情况（内部子栏目）',
        evidence_json: { headings: overallSubs },
      })
    );
    for (const h of overallSubs) {
      issues.push(
        issue({
          check_key: 'SRC_SECTION_LEVEL_MISMATCH',
          issue_class: 'source_format',
          responsibility: 'source',
          severity: 'warning',
          group_key: 'section',
          title: `标题层级疑似错误：${h.raw_title}`,
          message: `“${h.raw_title}”更可能是“总体情况”内部事项，却使用了顶级章节编号。`,
          source_page: null,
          source_excerpt: h.source_excerpt,
          raw_title: h.raw_title,
          canonical_title: '一、总体情况（子栏目）',
          evidence_json: { semantic_type: h.semantic_type, line: h.line },
        })
      );
    }
  }

  // Ordinal mismatch: 四 + 申请
  for (const h of topLevel) {
    if (h.ordinal === '四' && /申请/.test(h.raw_title) && !/复议|诉讼/.test(h.raw_title)) {
      issues.push(
        issue({
          check_key: 'SRC_SECTION_ORDINAL_MISMATCH',
          issue_class: 'source_format',
          responsibility: 'source',
          severity: 'error',
          group_key: 'section',
          title: '标题编号与语义不符：四、…申请…',
          message:
            '源文件将“政府信息公开申请”写在“四、”下。按规范，申请办理属第三部分；第四部分应为行政复议、行政诉讼。若该段位于总体情况叙述中，则更可能是总体情况子栏目误用顶级编号。',
          source_page: null,
          source_excerpt: h.raw_title,
          raw_title: h.raw_title,
          canonical_title: '三、收到和处理政府信息公开申请情况 / 或总体情况-依申请公开方面',
          expected_value: '三、…申请… 或 （二）依申请公开方面',
          actual_value: h.raw_title,
        })
      );
    }
    if (h.ordinal === '一' && /主动公开政府信息情况/.test(h.raw_title)) {
      // likely second system where 一 should be 二
      issues.push(
        issue({
          check_key: 'SRC_SECTION_ORDINAL_MISMATCH',
          issue_class: 'source_format',
          responsibility: 'source',
          severity: 'error',
          group_key: 'section',
          title: '法定章节编号疑似整体偏移：一、主动公开…',
          message:
            '源文件将“主动公开政府信息情况”标为“一、”。按规范六个法定部分，该部分应为“二、主动公开政府信息情况”。常见于后半部分章节整体少编号一位。',
          source_page: null,
          source_excerpt: h.raw_title,
          raw_title: h.raw_title,
          canonical_title: '二、主动公开政府信息情况',
          expected_value: '二、主动公开政府信息情况',
          actual_value: h.raw_title,
        })
      );
    }
  }

  // Shifted statutory block: 一主动公开…二申请…三复议…四问题…五其他
  const joined = topLevel.map((h) => h.raw_title).join('\n');
  if (
    /一、.*主动公开政府信息情况/.test(joined) &&
    /二、.*申请/.test(joined) &&
    /三、.*复议|三、.*诉讼/.test(joined) &&
    /五、.*其他需要报告/.test(joined)
  ) {
    issues.push(
      issue({
        check_key: 'SRC_SECTION_ORDER',
        issue_class: 'source_format',
        responsibility: 'source',
        severity: 'error',
        group_key: 'section',
        title: '后半部分法定章节编号整体少一位',
        message:
          '源文件后半部分将法定二至六部分写成了一至五（一、主动公开… … 五、其他需要报告的事项）。规范编号应为二至六。',
        source_page: null,
        source_excerpt: joined.slice(0, 500),
        evidence_json: { pattern: 'shifted_statutory_block' },
      })
    );
  }

  // Content issues
  const full = String(sourceText || '');
  if (/资金资金/.test(full)) {
    const idx = full.indexOf('资金资金');
    issues.push(
      issue({
        check_key: 'SRC_TEXT_DUPLICATED_WORD',
        issue_class: 'source_content',
        responsibility: 'source',
        severity: 'warning',
        group_key: 'text',
        title: '疑似用词重复：“资金资金”',
        message: '正文出现“资金资金”，疑似“资金”重复。',
        source_page: null,
        source_excerpt: full.slice(Math.max(0, idx - 20), idx + 30),
      })
    );
  }
  if (/审查管(?!理)/.test(full) || /信息发布审查管[^理]/.test(full)) {
    const idx = full.search(/审查管/);
    issues.push(
      issue({
        check_key: 'SRC_TEXT_INCOMPLETE_SENTENCE',
        issue_class: 'source_content',
        responsibility: 'source',
        severity: 'warning',
        group_key: 'text',
        title: '疑似残句：“审查管”',
        message: '正文出现“审查管”，语句疑似残缺，可能缺少“理”（审查管理）。',
        source_page: null,
        source_excerpt: full.slice(Math.max(0, idx - 20), idx + 25),
      })
    );
  }
  if (/重新涉及部门网站/.test(full)) {
    const idx = full.indexOf('重新涉及');
    issues.push(
      issue({
        check_key: 'SRC_TEXT_SUSPICIOUS_WORDING',
        issue_class: 'source_content',
        responsibility: 'source',
        severity: 'warning',
        group_key: 'text',
        title: '疑似用词错误：“重新涉及部门网站…”',
        message: '结合上下文，“重新涉及部门网站政务公开栏目”疑似应为“重新设计…”。',
        source_page: null,
        source_excerpt: full.slice(Math.max(0, idx - 10), idx + 40),
      })
    );
  }
  if (/六部分,/.test(full) || /六部分，/.test(full) === false && /六部分,/.test(full)) {
    // english comma after 六部分
  }
  if (/六部分,/.test(full)) {
    issues.push(
      issue({
        check_key: 'SRC_TEXT_PUNCTUATION',
        issue_class: 'source_content',
        responsibility: 'source',
        severity: 'info',
        group_key: 'text',
        title: '标点不规范：使用英文逗号',
        message: '正文“六部分,”使用了英文逗号，建议使用中文标点。',
        source_page: null,
        source_excerpt: '六部分,',
      })
    );
  }

  
  const lexicon = [...TEXT_QUALITY_LEXICON, ...loadExtraTextLexicon()];
  for (const rule of lexicon) {
    if (!rule.re.test(full)) continue;
    rule.re.lastIndex = 0;
    const m = full.match(rule.re);
    const idx = m ? full.search(rule.re) : -1;
    issues.push(
      issue({
        check_key: rule.check_key,
        issue_class: 'source_content',
        responsibility: 'source',
        severity: rule.severity,
        group_key: 'text',
        title: rule.title,
        message: rule.message,
        source_page: idx >= 0 ? estimatePageFromLine(full, full.slice(0, idx).split(/\n/).length) : null,
        source_excerpt: idx >= 0 ? full.slice(Math.max(0, idx - 20), idx + 40) : '',
        evidence_json: { lexicon_id: rule.id },
      })
    );
  }

// Internal contradiction: all finished vs carry-over 1
  if (/所有申请均已按要求办理完成/.test(full) && /转下一年度办理|结转下年度/.test(full)) {
    issues.push(
      issue({
        check_key: 'SRC_TEXT_INTERNAL_CONTRADICTION',
        issue_class: 'source_content',
        responsibility: 'source',
        severity: 'error',
        group_key: 'text',
        title: '正文内部矛盾：办结完成 vs 结转下年度',
        message:
          '正文写“所有申请均已按要求办理完成”，同时又出现“转下一年度办理/结转下年度”，内容自相矛盾。',
        source_page: null,
        source_excerpt: '所有申请均已按要求办理完成 … 转下一年度/结转下年度',
        evidence_json: { patterns: ['all_finished', 'carry_next_year'] },
      })
    );
  }

  return {
    raw_source_outline: outline,
    issues,
    has_multiple_numbering_systems: hasMultiple,
    overall_subtopics_as_top_level: overallSubs.length >= 2,
  };
}

/**
 * Compare source-derived table_2 values with parsed activeDisclosureData.
 * 0 is a valid value; null means missing in parsed.
 */
export function reconcileTable2SourceVsParsed(
  sourceTable2Text: string,
  parsedActive: any,
  sourcePage: number | null = null
): SourceAuditIssue[] {
  const { tryParseTable2FromSourceText } = require('./TableSectionScoring') as typeof import('./TableSectionScoring');
  const fromSource = tryParseTable2FromSourceText(sourceTable2Text);
  if (!fromSource) return [];

  const issues: SourceAuditIssue[] = [];
  const paths: Array<{ path: string; label: string; expected: number | null }> = [
    { path: 'regulations.made', label: '规章-本年制发', expected: fromSource.regulations?.made ?? null },
    { path: 'regulations.repealed', label: '规章-本年废止', expected: fromSource.regulations?.repealed ?? null },
    { path: 'regulations.valid', label: '规章-现行有效', expected: fromSource.regulations?.valid ?? null },
    {
      path: 'normativeDocuments.made',
      label: '规范性文件-本年制发',
      expected: fromSource.normativeDocuments?.made ?? null,
    },
    {
      path: 'normativeDocuments.repealed',
      label: '规范性文件-本年废止',
      expected: fromSource.normativeDocuments?.repealed ?? null,
    },
    {
      path: 'normativeDocuments.valid',
      label: '规范性文件-现行有效',
      expected: fromSource.normativeDocuments?.valid ?? null,
    },
    { path: 'licensing.processed', label: '行政许可', expected: fromSource.licensing?.processed ?? null },
    { path: 'punishment.processed', label: '行政处罚', expected: fromSource.punishment?.processed ?? null },
    { path: 'coercion.processed', label: '行政强制', expected: fromSource.coercion?.processed ?? null },
    { path: 'fees.amount', label: '行政事业性收费', expected: fromSource.fees?.amount ?? null },
  ];

  const read = (obj: any, path: string): any => {
    return path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), obj);
  };

  for (const p of paths) {
    if (p.expected === null || p.expected === undefined) continue;
    const actual = read(parsedActive, p.path);
    if (actual === null || actual === undefined || actual === '') {
      issues.push(
        issue({
          check_key: actual === null ? 'EXT_ZERO_PARSED_AS_NULL' : 'EXT_SOURCE_VALUE_MISSING_IN_PARSED',
          issue_class: 'extraction',
          responsibility: 'system',
          severity: 'error',
          group_key: 'table2',
          title: `系统抽取异常：${p.label} 源文件有值但结构化结果为空`,
          message: `源文件中 ${p.label} 可识别为 ${p.expected}，但结构化结果为 ${String(actual)}。应归责于系统抽取/切段，不得记为“源材料未填写”。`,
          source_page: sourcePage,
          source_excerpt: sourceTable2Text.slice(0, 240),
          expected_value: String(p.expected),
          actual_value: actual === null ? 'null' : String(actual),
          evidence_json: { path: p.path, expected: p.expected, actual },
        })
      );
    } else if (Number(actual) !== Number(p.expected)) {
      // only flag if source clearly had the number
      issues.push(
        issue({
          check_key: 'EXT_SOURCE_VALUE_MISSING_IN_PARSED',
          issue_class: 'extraction',
          responsibility: 'system',
          severity: 'warning',
          group_key: 'table2',
          title: `系统抽取值与源文件不一致：${p.label}`,
          message: `源文件识别为 ${p.expected}，结构化结果为 ${actual}。`,
          source_page: sourcePage,
          source_excerpt: sourceTable2Text.slice(0, 240),
          expected_value: String(p.expected),
          actual_value: String(actual),
        })
      );
    }
  }

  return issues;
}
