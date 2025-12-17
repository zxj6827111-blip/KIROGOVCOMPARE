export type DiffChange = 'added' | 'removed' | 'changed';

export interface DiffEntry {
  path: string;
  change: DiffChange;
  left?: unknown;
  right?: unknown;
}

export interface JsonDiff {
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffEntry[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildPath(base: string, key: string | number): string {
  if (base === '') {
    return `${key}`;
  }
  if (typeof key === 'number') {
    return `${base}[${key}]`;
  }
  return `${base}.${key}`;
}

export function diffJson(left: unknown, right: unknown, basePath = ''): JsonDiff {
  const diff: JsonDiff = { added: [], removed: [], changed: [] };

  // Both values missing
  if (left === undefined && right === undefined) {
    return diff;
  }

  if (isObject(left) && isObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      const newPath = buildPath(basePath, key);
      const childDiff = diffJson((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], newPath);
      diff.added.push(...childDiff.added);
      diff.removed.push(...childDiff.removed);
      diff.changed.push(...childDiff.changed);
    }
    return diff;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const maxLength = Math.max(left.length, right.length);
    for (let index = 0; index < maxLength; index += 1) {
      const newPath = buildPath(basePath, index);
      const childDiff = diffJson(left[index], right[index], newPath);
      diff.added.push(...childDiff.added);
      diff.removed.push(...childDiff.removed);
      diff.changed.push(...childDiff.changed);
    }
    return diff;
  }

  if (left === undefined) {
    diff.added.push({ path: basePath, change: 'added', right });
    return diff;
  }

  if (right === undefined) {
    diff.removed.push({ path: basePath, change: 'removed', left });
    return diff;
  }

  if (left !== right) {
    diff.changed.push({ path: basePath, change: 'changed', left, right });
  }

  return diff;
}

export function summarizeDiff(left: unknown, right: unknown): JsonDiff {
  return diffJson(left, right);
}
