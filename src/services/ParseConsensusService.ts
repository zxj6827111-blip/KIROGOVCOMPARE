import { createHash } from 'crypto';
import { JsonDiff, summarizeDiff } from '../utils/jsonDiff';

type AnyRecord = Record<string, any>;
type CriticalSectionType = 'table_2' | 'table_3' | 'table_4';

const CRITICAL_SECTIONS: CriticalSectionType[] = ['table_2', 'table_3', 'table_4'];

const TABLE3_BREAKDOWN_PATHS = [
  'granted',
  'partialGrant',
  'denied.stateSecret',
  'denied.lawForbidden',
  'denied.safetyStability',
  'denied.thirdPartyRights',
  'denied.internalAffairs',
  'denied.processInfo',
  'denied.enforcementCase',
  'denied.adminQuery',
  'unableToProvide.noInfo',
  'unableToProvide.needCreation',
  'unableToProvide.unclear',
  'notProcessed.complaint',
  'notProcessed.repeat',
  'notProcessed.publication',
  'notProcessed.massiveRequests',
  'notProcessed.confirmInfo',
  'other.overdueCorrection',
  'other.overdueFee',
  'other.otherReasons',
];

export interface SectionConsensusItem {
  section: CriticalSectionType;
  matched: boolean;
  primaryHash: string;
  verifierHash: string;
  added: number;
  removed: number;
  changed: number;
  samplePaths: string[];
}

export interface ParseConsensusResult {
  matched: boolean;
  primaryHash: string;
  verifierHash: string;
  mismatchedSections: CriticalSectionType[];
  sections: SectionConsensusItem[];
}

export interface ParseRuleCheckResult {
  passed: boolean;
  issues: string[];
}

function toFiniteNumber(value: any): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === '/' || trimmed === '-' || trimmed === '--') return null;

  const normalized = trimmed.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPath(source: any, path: string): any {
  const keys = path.split('.');
  let current = source;
  for (const key of keys) {
    current = current?.[key];
  }
  return current;
}

function canonicalizeValue(value: any): any {
  if (value === undefined || value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const output: AnyRecord = {};
    for (const key of keys) {
      output[key] = canonicalizeValue(value[key]);
    }
    return output;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const numeric = toFiniteNumber(trimmed);
    if (numeric !== null) {
      return numeric;
    }

    return trimmed;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return String(value);
}

function hashCanonical(value: any): string {
  const canonical = canonicalizeValue(value);
  const serialized = JSON.stringify(canonical);
  return createHash('sha256').update(serialized).digest('hex');
}

function extractSectionPayload(output: any, sectionType: CriticalSectionType): any {
  const sections = Array.isArray(output?.sections) ? output.sections : [];
  const section = sections.find((item: any) => item?.type === sectionType);

  if (sectionType === 'table_2') {
    return section?.activeDisclosureData ?? output?.activeDisclosureData ?? null;
  }
  if (sectionType === 'table_3') {
    return section?.tableData ?? output?.tableData ?? null;
  }
  return section?.reviewLitigationData ?? output?.reviewLitigationData ?? null;
}

function summarizeDiffPaths(diff: JsonDiff, maxItems = 12): string[] {
  return [...diff.added, ...diff.removed, ...diff.changed]
    .map((item) => item.path)
    .filter(Boolean)
    .slice(0, maxItems);
}

function checkTable3Rules(tableData: any, issues: string[]): void {
  if (!tableData || typeof tableData !== 'object') {
    issues.push('table_3 missing or invalid');
    return;
  }

  const entities: Array<{ label: string; node: AnyRecord | undefined }> = [
    { label: 'naturalPerson', node: tableData?.naturalPerson },
    { label: 'legalPerson.commercial', node: tableData?.legalPerson?.commercial },
    { label: 'legalPerson.research', node: tableData?.legalPerson?.research },
    { label: 'legalPerson.social', node: tableData?.legalPerson?.social },
    { label: 'legalPerson.legal', node: tableData?.legalPerson?.legal },
    { label: 'legalPerson.other', node: tableData?.legalPerson?.other },
    { label: 'total', node: tableData?.total },
  ];

  for (const entity of entities) {
    const results = entity.node?.results;
    if (!results || typeof results !== 'object') {
      continue;
    }

    const values = TABLE3_BREAKDOWN_PATHS.map((path) => toFiniteNumber(readPath(results, path)));
    if (values.some((value) => value === null)) {
      continue;
    }

    const expected = (values as number[]).reduce((sum, value) => sum + value, 0);
    const reported = toFiniteNumber(results.totalProcessed);
    if (reported !== null && reported !== expected) {
      issues.push(`table_3.${entity.label}.results.totalProcessed expected ${expected}, got ${reported}`);
    }
  }

  const subEntities: AnyRecord[] = [
    tableData?.naturalPerson,
    tableData?.legalPerson?.commercial,
    tableData?.legalPerson?.research,
    tableData?.legalPerson?.social,
    tableData?.legalPerson?.legal,
    tableData?.legalPerson?.other,
  ].filter(Boolean);

  if (!tableData.total || typeof tableData.total !== 'object' || subEntities.length !== 6) {
    return;
  }

  const totalsToCheck = [
    'newReceived',
    'carriedOver',
    'results.totalProcessed',
    'results.carriedForward',
  ];

  for (const targetPath of totalsToCheck) {
    const values = subEntities.map((entity) => toFiniteNumber(readPath(entity, targetPath)));
    if (values.some((value) => value === null)) {
      continue;
    }

    const expected = (values as number[]).reduce((sum, value) => sum + value, 0);
    const reported = toFiniteNumber(readPath(tableData.total, targetPath));
    if (reported !== null && reported !== expected) {
      issues.push(`table_3.total.${targetPath} expected ${expected}, got ${reported}`);
    }
  }
}

function checkTable4Rules(tableData: any, issues: string[]): void {
  if (!tableData || typeof tableData !== 'object') {
    issues.push('table_4 missing or invalid');
    return;
  }

  const blocks = ['review', 'litigationDirect', 'litigationPostReview'];
  for (const block of blocks) {
    const node = tableData?.[block];
    if (!node || typeof node !== 'object') {
      continue;
    }

    const parts = ['maintain', 'correct', 'other', 'unfinished'].map((key) => toFiniteNumber(node[key]));
    if (parts.some((value) => value === null)) {
      continue;
    }

    const expected = (parts as number[]).reduce((sum, value) => sum + value, 0);
    const reported = toFiniteNumber(node.total);
    if (reported !== null && reported !== expected) {
      issues.push(`table_4.${block}.total expected ${expected}, got ${reported}`);
    }
  }
}

export class ParseConsensusService {
  compareCriticalSections(primaryOutput: any, verifierOutput: any): ParseConsensusResult {
    const sectionItems: SectionConsensusItem[] = CRITICAL_SECTIONS.map((sectionType) => {
      const primarySection = canonicalizeValue(extractSectionPayload(primaryOutput, sectionType));
      const verifierSection = canonicalizeValue(extractSectionPayload(verifierOutput, sectionType));

      const primaryHash = hashCanonical(primarySection);
      const verifierHash = hashCanonical(verifierSection);
      const matched = primaryHash === verifierHash;

      let added = 0;
      let removed = 0;
      let changed = 0;
      let samplePaths: string[] = [];
      if (!matched) {
        const diff = summarizeDiff(primarySection, verifierSection);
        added = diff.added.length;
        removed = diff.removed.length;
        changed = diff.changed.length;
        samplePaths = summarizeDiffPaths(diff);
      }

      return {
        section: sectionType,
        matched,
        primaryHash,
        verifierHash,
        added,
        removed,
        changed,
        samplePaths,
      };
    });

    const primaryBundle = canonicalizeValue(
      CRITICAL_SECTIONS.reduce((acc, sectionType) => {
        acc[sectionType] = extractSectionPayload(primaryOutput, sectionType);
        return acc;
      }, {} as AnyRecord)
    );
    const verifierBundle = canonicalizeValue(
      CRITICAL_SECTIONS.reduce((acc, sectionType) => {
        acc[sectionType] = extractSectionPayload(verifierOutput, sectionType);
        return acc;
      }, {} as AnyRecord)
    );

    const mismatchedSections = sectionItems.filter((item) => !item.matched).map((item) => item.section);
    return {
      matched: mismatchedSections.length === 0,
      primaryHash: hashCanonical(primaryBundle),
      verifierHash: hashCanonical(verifierBundle),
      mismatchedSections,
      sections: sectionItems,
    };
  }

  checkDeterministicRules(output: any): ParseRuleCheckResult {
    const issues: string[] = [];

    const table3 = extractSectionPayload(output, 'table_3');
    const table4 = extractSectionPayload(output, 'table_4');

    checkTable3Rules(table3, issues);
    checkTable4Rules(table4, issues);

    return {
      passed: issues.length === 0,
      issues,
    };
  }
}

export const parseConsensusService = new ParseConsensusService();
