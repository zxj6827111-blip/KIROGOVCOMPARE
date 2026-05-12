export type MaintenanceStatus = 'missing' | 'empty' | 'text_empty';

export interface MaintenanceReportRow {
  report_id: number | string;
  region_id: number | string;
  year: number | string;
  effective_version_id: number | string | null;
  parsed_json: any;
  raw_text: string | null;
}

export interface ReportContentQuality {
  status: MaintenanceStatus | null;
  raw_text_length: number;
  parsed_text_length: number;
  source_content_empty: boolean;
  has_meaningful_table_data: boolean;
  suppress_display_tables: boolean;
}

export const toRegionKey = (regionId: unknown): string => String(regionId ?? '');

const MAINTENANCE_TEXT_THRESHOLD = 100;
const MAINTENANCE_STRUCTURED_KEYS = new Set(['sections', 'subsections', 'children', 'items', 'content', 'paragraphs']);
const MAINTENANCE_TEXT_KEYS = new Set(['content', 'text']);
const MAINTENANCE_METADATA_KEYS = new Set([
  'type',
  'title',
  'file_hash',
  'file_size',
  'report_id',
  'version_id',
  'generated_at',
  'storage_path',
  'visual_audit',
  'tableData',
  'activeDisclosureData',
  'reviewLitigationData',
]);

export const hasEffectiveMaintenanceContent = (parsed: any): boolean => {
  if (!parsed || typeof parsed !== 'object') return false;
  if (Array.isArray(parsed.sections) && parsed.sections.length > 0) return true;
  if (parsed.tables && typeof parsed.tables === 'object' && Object.keys(parsed.tables).length > 0) return true;
  if (Array.isArray(parsed.content) && parsed.content.length > 0) return true;
  return false;
};

const isMeaningfulStructuredValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '0' || trimmed === '/' || trimmed === '-' || trimmed === '\u2014') {
      return false;
    }
    const numeric = Number(trimmed);
    return !Number.isFinite(numeric) || numeric !== 0;
  }
  if (typeof value === 'boolean') return value;
  return false;
};

const hasMeaningfulStructuredValues = (node: unknown): boolean => {
  if (Array.isArray(node)) {
    return node.some(hasMeaningfulStructuredValues);
  }

  if (!node || typeof node !== 'object') {
    return isMeaningfulStructuredValue(node);
  }

  return Object.values(node as Record<string, unknown>).some((value) => {
    if (value && typeof value === 'object') {
      return hasMeaningfulStructuredValues(value);
    }
    return isMeaningfulStructuredValue(value);
  });
};

export const hasMeaningfulMaintenanceTableData = (parsed: any): boolean => {
  if (!parsed || typeof parsed !== 'object') return false;

  const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
  for (const section of sections) {
    if (!section || typeof section !== 'object') continue;
    const record = section as Record<string, unknown>;
    if (
      hasMeaningfulStructuredValues(record.activeDisclosureData)
      || hasMeaningfulStructuredValues(record.tableData)
      || hasMeaningfulStructuredValues(record.reviewLitigationData)
    ) {
      return true;
    }
  }

  return (
    hasMeaningfulStructuredValues(parsed.activeDisclosureData)
    || hasMeaningfulStructuredValues(parsed.tableData)
    || hasMeaningfulStructuredValues(parsed.reviewLitigationData)
    || hasMeaningfulStructuredValues(parsed.tables)
  );
};

export const getParsedNarrativeTextLength = (node: unknown, parentKey = ''): number => {
  if (node == null) return 0;

  if (typeof node === 'string') {
    return MAINTENANCE_TEXT_KEYS.has(parentKey) ? node.trim().length : 0;
  }

  if (Array.isArray(node)) {
    return node.reduce((sum, item) => sum + getParsedNarrativeTextLength(item, parentKey), 0);
  }

  if (typeof node !== 'object') {
    return 0;
  }

  return Object.entries(node as Record<string, unknown>).reduce((sum, [key, value]) => {
    if (MAINTENANCE_METADATA_KEYS.has(key)) {
      return sum;
    }

    if (
      MAINTENANCE_STRUCTURED_KEYS.has(key)
      || MAINTENANCE_TEXT_KEYS.has(key)
      || parentKey === 'sections'
      || parentKey === 'subsections'
      || parentKey === 'paragraphs'
      || parentKey === 'content'
    ) {
      return sum + getParsedNarrativeTextLength(value, key);
    }

    return sum;
  }, 0);
};

export const getReportMaintenanceStatus = (report?: MaintenanceReportRow | null): MaintenanceStatus | null => {
  if (!report) {
    return 'missing';
  }

  const isJsonEmpty = !report.effective_version_id || !hasEffectiveMaintenanceContent(report.parsed_json);
  if (isJsonEmpty) {
    return 'empty';
  }

  const rawTextLength = typeof report.raw_text === 'string' ? report.raw_text.trim().length : 0;
  const parsedTextLength = getParsedNarrativeTextLength(report.parsed_json);
  if (
    rawTextLength < MAINTENANCE_TEXT_THRESHOLD
    && parsedTextLength < MAINTENANCE_TEXT_THRESHOLD
    && !hasMeaningfulMaintenanceTableData(report.parsed_json)
  ) {
    return 'empty';
  }

  const isTextEmpty = rawTextLength < MAINTENANCE_TEXT_THRESHOLD && parsedTextLength < MAINTENANCE_TEXT_THRESHOLD;

  if (isTextEmpty) {
    return 'text_empty';
  }

  return null;
};

export const getReportContentQuality = (report?: MaintenanceReportRow | null): ReportContentQuality => {
  const rawTextLength = typeof report?.raw_text === 'string' ? report.raw_text.trim().length : 0;
  const parsedTextLength = getParsedNarrativeTextLength(report?.parsed_json);
  const hasMeaningfulTableData = hasMeaningfulMaintenanceTableData(report?.parsed_json);
  const sourceContentEmpty = rawTextLength < MAINTENANCE_TEXT_THRESHOLD && parsedTextLength < MAINTENANCE_TEXT_THRESHOLD;
  const status = getReportMaintenanceStatus(report);

  return {
    status,
    raw_text_length: rawTextLength,
    parsed_text_length: parsedTextLength,
    source_content_empty: sourceContentEmpty,
    has_meaningful_table_data: hasMeaningfulTableData,
    suppress_display_tables: Boolean(report) && sourceContentEmpty,
  };
};
