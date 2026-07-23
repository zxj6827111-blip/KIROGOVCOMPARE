/**
 * Field-level merge for structured table payloads.
 * Prefer deterministic explicit values (including 0); keep LLM/native when
 * deterministic is empty; record conflicts for human review.
 *
 * Production use for det-wins is limited to table_2 via mergeTable2Fields.
 */

export type MergeConflict = {
  path: string;
  deterministic: unknown;
  existing: unknown;
};

export type FieldMergeResult<T> = {
  merged: T;
  usedDeterministicPaths: string[];
  keptExistingPaths: string[];
  conflicts: MergeConflict[];
};

export type FieldMergePolicy = 'deterministic_wins' | 'existing_wins_on_conflict';

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (String(a) === String(b)) return true;
  if (typeof a === 'number' || typeof b === 'number' || typeof a === 'string' || typeof b === 'string') {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na === nb) return true;
  }
  return false;
}

/**
 * Deep merge objects.
 * policy:
 * - deterministic_wins (default for table2): det non-empty wins on conflict (0 is non-empty)
 * - existing_wins_on_conflict: keep existing on conflict, still record conflict
 */
export function mergeStructuredFields<T extends Record<string, any>>(
  existing: T | null | undefined,
  deterministic: T | null | undefined,
  basePath = '',
  policy: FieldMergePolicy = 'deterministic_wins'
): FieldMergeResult<T> {
  const usedDeterministicPaths: string[] = [];
  const keptExistingPaths: string[] = [];
  const conflicts: MergeConflict[] = [];

  if (!deterministic || typeof deterministic !== 'object') {
    return {
      merged: (existing ?? deterministic ?? {}) as T,
      usedDeterministicPaths,
      keptExistingPaths,
      conflicts,
    };
  }
  if (!existing || typeof existing !== 'object') {
    return {
      merged: deterministic as T,
      usedDeterministicPaths: basePath ? [basePath] : Object.keys(deterministic),
      keptExistingPaths,
      conflicts,
    };
  }

  const out: Record<string, any> = { ...existing };

  const walk = (ex: any, det: any, path: string) => {
    if (!isPlainObject(det)) {
      return;
    }
    for (const key of Object.keys(det)) {
      const p = path ? `${path}.${key}` : key;
      const dVal = det[key];
      const eVal = ex != null ? ex[key] : undefined;

      if (isPlainObject(dVal)) {
        if (!isPlainObject(eVal)) {
          if (!isEmptyValue(dVal) && Object.keys(dVal).length > 0) {
            const nestedEx = {};
            outNestedAssign(out, p, nestedEx);
            walk(nestedEx, dVal, p);
          }
          continue;
        }
        walk(eVal, dVal, p);
        continue;
      }

      if (!isEmptyValue(dVal)) {
        if (isEmptyValue(eVal)) {
          setPath(out, p, dVal);
          usedDeterministicPaths.push(p);
        } else if (valuesEqual(eVal, dVal)) {
          setPath(out, p, dVal);
          usedDeterministicPaths.push(p);
        } else {
          conflicts.push({ path: p, deterministic: dVal, existing: eVal });
          if (policy === 'deterministic_wins') {
            setPath(out, p, dVal);
            usedDeterministicPaths.push(p);
          } else {
            keptExistingPaths.push(p);
          }
        }
      } else if (!isEmptyValue(eVal)) {
        keptExistingPaths.push(p);
      }
    }
  };

  walk(existing, deterministic, basePath);
  return {
    merged: out as T,
    usedDeterministicPaths,
    keptExistingPaths,
    conflicts,
  };
}

/**
 * Table-2 only merge path: deterministic non-empty (incl. 0) always wins over AI.
 * Prefer this in production callers so other tables are not implicitly retargeted.
 */
export function mergeTable2Fields<T extends Record<string, any>>(
  existing: T | null | undefined,
  deterministic: T | null | undefined
): FieldMergeResult<T> {
  return mergeStructuredFields(existing, deterministic, '', 'deterministic_wins');
}


/**
 * Production helper for table_2 after AI parse (parallel or serial path).
 * Deterministic non-empty wins; empty det keeps AI; conflicts preserved.
 */
export function applyTable2DeterministicOverlay(
  existingTable2: { activeDisclosureData?: any } | null | undefined,
  deterministic: Record<string, any> | null | undefined
): { activeDisclosureData: any; merge_conflicts?: MergeConflict[] } {
  if (!deterministic) {
    return { activeDisclosureData: existingTable2?.activeDisclosureData ?? null };
  }
  const existing = existingTable2?.activeDisclosureData || {};
  const merged = mergeTable2Fields(existing as any, deterministic as any);
  const out: { activeDisclosureData: any; merge_conflicts?: MergeConflict[] } = {
    activeDisclosureData: merged.merged,
  };
  if (merged.conflicts.length) {
    out.merge_conflicts = merged.conflicts;
  }
  return out;
}

function setPath(obj: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const k = parts[i];
    if (!isPlainObject(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

function outNestedAssign(obj: Record<string, any>, path: string, nested: any): void {
  setPath(obj, path, nested);
}

/** Estimate page number from line index using form-feed or ~50 lines/page heuristic. */
export function estimatePageFromLine(fullText: string, lineNumber1Based: number): number {
  const lines = String(fullText || '').split(/\n/);
  const idx = Math.max(0, Math.min(lines.length, lineNumber1Based) - 1);
  let page = 1;
  for (let i = 0; i <= idx; i += 1) {
    if (lines[i] && lines[i].includes('\f')) page += 1;
  }
  if (page === 1) {
    page = Math.max(1, Math.floor(idx / 48) + 1);
  }
  return page;
}
