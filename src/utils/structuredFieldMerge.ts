/**
 * Field-level merge for structured table payloads.
 * Prefer deterministic explicit values; keep LLM/native when deterministic is empty;
 * record conflicts for human review.
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

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Deep merge objects: deterministic non-empty wins; empty deterministic keeps existing;
 * both non-empty and unequal → keep existing, record conflict (safer for human review).
 */
export function mergeStructuredFields<T extends Record<string, any>>(
  existing: T | null | undefined,
  deterministic: T | null | undefined,
  basePath = ''
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
            // if any nested non-empty, create object and walk
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
        } else if (String(eVal) === String(dVal) || Number(eVal) === Number(dVal)) {
          // same value
          setPath(out, p, dVal);
          usedDeterministicPaths.push(p);
        } else {
          // conflict: keep existing LLM value, flag
          conflicts.push({ path: p, deterministic: dVal, existing: eVal });
          keptExistingPaths.push(p);
        }
      } else {
        // deterministic empty → keep existing
        if (!isEmptyValue(eVal)) {
          keptExistingPaths.push(p);
        }
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
    // heuristic: ~48 lines per page for typical annual report text extraction
    page = Math.max(1, Math.floor(idx / 48) + 1);
  }
  return page;
}
