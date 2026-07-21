function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '{}' || trimmed === 'null' || trimmed === '""') {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function isNonEmptyObject(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length > 0);
}

function hasMeaningfulTextContent(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value.trim().length >= 20;
}

/**
 * True only when parse output has real annual-report payload (tables/text sections),
 * not metadata-only shells that used to short-circuit re-parse.
 */
export function hasParsedContent(value: unknown): boolean {
  const parsed = parseMaybeJson(value);
  if (parsed === null || parsed === undefined) return false;
  // Bare non-JSON strings are not structured annual-report content.
  if (typeof parsed === 'string') return false;
  if (Array.isArray(parsed)) {
    return parsed.some((item) => hasParsedContent(item));
  }
  if (typeof parsed !== 'object') return false;

  const obj = parsed as Record<string, unknown>;
  const sections = obj.sections;
  if (Array.isArray(sections) && sections.length > 0) {
    return sections.some((section) => {
      if (!section || typeof section !== 'object') return false;
      const record = section as Record<string, unknown>;
      if (isNonEmptyObject(record.activeDisclosureData)) return true;
      if (isNonEmptyObject(record.tableData)) return true;
      if (isNonEmptyObject(record.reviewLitigationData)) return true;
      if (hasMeaningfulTextContent(record.content)) return true;
      return false;
    });
  }

  if (obj.tables && typeof obj.tables === 'object') {
    const tables = obj.tables as Record<string, unknown>;
    if (Object.values(tables).some((t) => isNonEmptyObject(t))) return true;
  }
  if (isNonEmptyObject(obj.activeDisclosureData)) return true;
  if (isNonEmptyObject(obj.tableData)) return true;
  if (isNonEmptyObject(obj.reviewLitigationData)) return true;

  // basic_info alone is metadata — do not treat as parsed content.
  return false;
}
