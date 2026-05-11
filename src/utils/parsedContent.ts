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

export function hasParsedContent(value: unknown): boolean {
  const parsed = parseMaybeJson(value);
  if (parsed === null || parsed === undefined) return false;
  if (typeof parsed === 'string') return parsed.trim().length > 0;
  if (Array.isArray(parsed)) return parsed.length > 0;
  if (typeof parsed !== 'object') return false;

  const obj = parsed as Record<string, unknown>;
  const sections = obj.sections;
  if (Array.isArray(sections)) {
    return sections.some((section) => {
      if (!section || typeof section !== 'object') return false;
      const record = section as Record<string, unknown>;
      return Boolean(
        record.activeDisclosureData ||
        record.tableData ||
        record.reviewLitigationData ||
        record.content
      );
    });
  }

  if (obj.tables && typeof obj.tables === 'object' && Object.keys(obj.tables as object).length > 0) return true;
  if (obj.activeDisclosureData || obj.tableData || obj.reviewLitigationData) return true;
  if (obj.basic_info && typeof obj.basic_info === 'object' && Object.keys(obj.basic_info as object).length > 0) return true;

  return false;
}
