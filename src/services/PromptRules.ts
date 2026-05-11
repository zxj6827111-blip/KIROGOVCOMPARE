export const PROMPT_RULES_VERSION = process.env.LLM_PROMPT_RULES_VERSION || 'v1.1';

const COMMON_RULES = [
  `PROMPT_RULES_VERSION=${PROMPT_RULES_VERSION}`,
  'Never split one table cell number into multiple fields. A source cell containing "20" must not become 2 and 0.',
  'Preserve numeric semantics exactly: explicit "0" is number 0; blank cells are null or ""; "/" "-" "--" "—" "无" "不适用" are strings, not 0.',
  'For table_3, keep applicant columns separate: naturalPerson, legalPerson.commercial, legalPerson.research, legalPerson.social, legalPerson.legal, legalPerson.other, total.',
  'For table_3 totals, do not invent balancing numbers. If the source total is missing or not assessable, preserve the missing marker instead of calculating a replacement.',
  'For table_4, map review, litigationDirect, and litigationPostReview independently. Do not merge the three blocks into one total.',
  'Return machine-parseable JSON only. Do not include markdown fences, comments, or explanatory prose.',
];

export function buildCommonPromptRules(options?: { includeTable4Rules?: boolean }): string {
  const rules = [...COMMON_RULES];
  if (options?.includeTable4Rules) {
    rules.push(
      'Table_4 flattened row rule: when one row contains 15 consecutive result cells, map cells 1-5 to review, 6-10 to litigationDirect, and 11-15 to litigationPostReview.'
    );
  }
  return ['=== COMMON PARSE RULES ===', ...dedupeRules(rules).map((rule, index) => `${index + 1}. ${rule}`)].join('\n');
}

export function injectCommonRules(systemInstruction: string, options?: { includeTable4Rules?: boolean }): string {
  const base = String(systemInstruction || '').trim();
  const rules = buildCommonPromptRules(options);
  if (!base) return rules;
  if (base.includes('=== COMMON PARSE RULES ===')) return base;
  return `${base}\n\n${rules}`;
}

export function dedupeRules(rules: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const rule of rules) {
    const normalized = rule.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(rule);
  }
  return output;
}
