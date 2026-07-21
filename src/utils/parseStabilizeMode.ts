/**
 * Parse stabilize mode resolution (table3 / table4 deterministic repairs).
 * Shared so JobRunner and unit tests exercise the same path.
 */

export type StabilizeOptions = { table3: boolean; table4: boolean };

/** Default production mode when LLM_PARSE_STABILIZE_MODE is unset. */
export const DEFAULT_PARSE_STABILIZE_MODE = 'table3,table4';

export function resolveStabilizeOptions(modeRaw: string): StabilizeOptions {
  const mode = String(modeRaw || '')
    .trim()
    .toLowerCase();
  if (!mode || mode === 'none' || mode === 'off' || mode === '0' || mode === 'false') {
    return { table3: false, table4: false };
  }
  if (mode === 'all' || mode === 'full' || mode === 'true' || mode === '1' || mode === 'on') {
    return { table3: true, table4: true };
  }
  if (mode === 'table4' || mode === 'table4-only') {
    return { table3: false, table4: true };
  }
  if (mode === 'table3' || mode === 'table3-only') {
    return { table3: true, table4: false };
  }
  // Comma / plus lists: "table3,table4", "table3+table4"
  const tokens = mode.split(/[,+|\s]+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length > 0) {
    const table3 = tokens.some((t) => t === 'table3' || t === 't3' || t === 'all' || t === 'full');
    const table4 = tokens.some((t) => t === 'table4' || t === 't4' || t === 'all' || t === 'full');
    if (table3 || table4) {
      return { table3, table4 };
    }
  }
  return { table3: false, table4: false };
}

export function resolveParseStabilizeModeFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.LLM_PARSE_STABILIZE_MODE;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return DEFAULT_PARSE_STABILIZE_MODE;
  }
  return String(raw).toLowerCase().trim();
}
