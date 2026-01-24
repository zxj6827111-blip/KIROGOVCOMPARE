import type { DataStatus, MetricValue } from './types';

export const STATUS_LABELS: Record<DataStatus, string> = {
  ok: '',
  missing: '待接入',
  not_connected: '未接入',
  changed_definition: '口径变更导致不可比',
};

export const formatNumber = (value?: number, digits: number = 0): string => {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

export const formatPercent = (value?: number, digits: number = 1): string => {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return `${Number(value).toFixed(digits)}%`;
};

export const getStatusLabel = (status: DataStatus): string => STATUS_LABELS[status] || '';

export const getMetricDisplay = (
  metric: MetricValue,
  formatter: (value?: number) => string
): string => {
  if (metric.status !== 'ok') {
    return getStatusLabel(metric.status);
  }
  return formatter(metric.value);
};

export const safeRate = (
  numerator?: number,
  denominator?: number
): { value?: number; status: DataStatus } => {
  if (denominator === undefined || denominator === null) {
    return { status: 'missing' };
  }
  if (denominator === 0) {
    return { status: 'changed_definition' };
  }
  if (numerator === undefined || numerator === null) {
    return { status: 'missing' };
  }
  return { value: (numerator / denominator) * 100, status: 'ok' };
};

export const safeShare = (
  part?: number,
  total?: number
): { value?: number; status: DataStatus } => {
  if (total === undefined || total === null) {
    return { status: 'missing' };
  }
  if (total === 0) {
    return { status: 'changed_definition' };
  }
  if (part === undefined || part === null) {
    return { status: 'missing' };
  }
  return { value: (part / total) * 100, status: 'ok' };
};

export const computeYoY = (current?: number, previous?: number): number | null => {
  if (current === undefined || previous === undefined) return null;
  if (previous === 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
};
