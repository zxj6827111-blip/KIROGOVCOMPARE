import type { GovInsightBackendReportPayload } from './aiReport';

export interface GovInsightReportSourceMeta {
  payloadSource?: string | null;
  materializeStatus?: string | null;
  sourceJobId?: number | string | null;
  sourceReportVersionId?: number | string | null;
  storedPayloadErrors?: string[] | null;
}

export interface GovInsightSourceStatusViewModel {
  sourceLabel: string;
  materializeLabel: string;
  sourceJobLabel: string;
  sourceVersionLabel: string;
  dataQualitySummary: string;
  warnings: string[];
  hasAnomaly: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  stored: '已保存正式 payload',
  rebuilt: '由后端即时重建 payload',
  missing: '未取得正式 payload',
};

const MATERIALIZE_LABELS: Record<string, string> = {
  official: '正式入库口径',
  preview: '预览/辅助口径',
  partial: '部分可用',
  missing: '缺少物化结果',
};

const labelFor = (value: unknown, labels: Record<string, string>, fallback: string): string => {
  const key = String(value ?? '').trim();
  if (!key) return fallback;
  return labels[key] || key;
};

const normalizeWarnings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

export const buildGovInsightSourceStatus = (
  payload?: (GovInsightBackendReportPayload & Record<string, unknown>) | null,
  meta?: GovInsightReportSourceMeta | null
): GovInsightSourceStatusViewModel => {
  const payloadQuality = payload?.dataQuality || {};
  const warnings = [
    ...normalizeWarnings(payloadQuality.warnings),
    ...normalizeWarnings(meta?.storedPayloadErrors),
  ];
  const materializeStatus =
    meta?.materializeStatus ||
    payload?.materializeStatus ||
    payload?.metricsSnapshot?.materializeStatus ||
    payloadQuality.materializeStatus ||
    '';
  const hasAnomaly = Boolean(payloadQuality.hasAnomaly || warnings.length > 0);
  const factConclusionAllowed = payloadQuality.factConclusionAllowed;

  return {
    sourceLabel: labelFor(meta?.payloadSource || payload?.payloadSource, SOURCE_LABELS, '未返回来源类型'),
    materializeLabel: labelFor(materializeStatus, MATERIALIZE_LABELS, '未返回物化状态'),
    sourceJobLabel: meta?.sourceJobId ? `任务 ${meta.sourceJobId}` : '暂无来源任务',
    sourceVersionLabel: meta?.sourceReportVersionId ? `版本 ${meta.sourceReportVersionId}` : '暂无来源版本',
    dataQualitySummary: hasAnomaly
      ? '存在数据质量提示，报告结论需结合来源复核'
      : factConclusionAllowed === false
        ? '当前底座不足以支持确定性事实结论'
        : '未返回阻断性数据质量提示',
    warnings,
    hasAnomaly,
  };
};
