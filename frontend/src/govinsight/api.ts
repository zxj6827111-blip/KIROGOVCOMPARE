/**
 * GovInsight API Client
 * 政务公开智慧治理大屏数据请求封装
 */

import type { AnnualDataRecord, OrgItem, ApiResponse } from './types';
import type { AnnualReportSummary, GovInsightBackendReportPayload } from './utils/aiReport';
import type {
  DisclosureMethod,
  CorrectionMethod,
  EntityComparisonModel,
  LeaderCockpitModel,
  ViewLevel,
} from './leader-cockpit/types';

const normalizeApiBase = (rawBase: string | undefined): string => {
  const normalized = (rawBase || '').trim().replace(/\/+$/, '');
  if (!normalized) return '/api';
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
};

const API_BASE = normalizeApiBase(process.env.REACT_APP_API_BASE_URL || process.env.REACT_APP_API_URL);

export interface GovInsightAIReportRecord {
  content: any;
  model: string;
  updatedAt: string;
  protocolVersion?: string | null;
  reportFormat?: string | null;
  payloadVersion?: string | null;
  promptVersion?: string | null;
  outputSchemaVersion?: string | null;
  materializeStatus?: string | null;
  sourceJobId?: number | null;
  sourceReportVersionId?: number | null;
  payloadSource?: 'stored' | 'rebuilt' | 'missing';
  storedPayloadErrors?: string[];
  reportPayload?: GovInsightBackendReportPayload | null;
}

export interface GovInsightAIReportReplayContext {
  regionId: number;
  year: number;
  updatedAt: string;
  modelUsed: string | null;
  reportFormat: string | null;
  protocolVersion: string | null;
  payloadVersion: string | null;
  promptVersion: string | null;
  outputSchemaVersion: string | null;
  materializeStatus: string | null;
  sourceJobId: number | null;
  sourceReportVersionId: number | null;
  storedPayloadErrors?: string[];
  payloadSource: 'stored' | 'rebuilt';
  reportPayload: GovInsightBackendReportPayload | Record<string, unknown> | null;
  promptText: string;
}

/**
 * 获取年度统计数据
 * @param year 年份（可选）
 * @param orgId 单位 ID（可选）
 * @param includeChildren 是否包含子级单位数据（可选）
 */
export async function fetchAnnualData(
  year?: number,
  orgId?: string,
  includeChildren?: boolean
): Promise<AnnualDataRecord[]> {
  const params = new URLSearchParams();
  if (year) params.set('year', String(year));
  if (orgId) params.set('org_id', orgId);
  if (includeChildren) params.set('include_children', 'true');

  const url = `${API_BASE}/gov-insight/annual-data${params.toString() ? '?' + params.toString() : ''}`;
  const response = await fetch(url, { credentials: 'include' });

  if (!response.ok) {
    throw new Error(`Failed to fetch annual data: ${response.status}`);
  }

  const result: ApiResponse<AnnualDataRecord[]> = await response.json();
  if (result.code !== 200) {
    throw new Error(result.msg || 'Unknown error');
  }

  return result.data;
}

/**
 * 获取可用年份列表
 */
export async function fetchYears(): Promise<number[]> {
  const url = `${API_BASE}/gov-insight/years`;
  const response = await fetch(url, { credentials: 'include' });

  if (!response.ok) {
    throw new Error(`Failed to fetch years: ${response.status}`);
  }

  const result: ApiResponse<number[]> = await response.json();
  if (result.code !== 200) {
    throw new Error(result.msg || 'Unknown error');
  }

  return result.data;
}

/**
 * 获取可用单位列表
 * @param year 年份（可选，用于过滤特定年份的单位）
 */
export async function fetchOrgs(year?: number): Promise<OrgItem[]> {
  const params = new URLSearchParams();
  if (year) params.set('year', String(year));

  const url = `${API_BASE}/gov-insight/orgs${params.toString() ? '?' + params.toString() : ''}`;
  const response = await fetch(url, { credentials: 'include' });

  if (!response.ok) {
    throw new Error(`Failed to fetch orgs: ${response.status}`);
  }

  const result: ApiResponse<OrgItem[]> = await response.json();
  if (result.code !== 200) {
    throw new Error(result.msg || 'Unknown error');
  }

  return result.data;
}

/**
 * 保存 AI 辅助决策报告
 */
export async function saveAIReport(
  orgId: string,
  orgName: string,
  year: number,
  content: any,
  model?: string
): Promise<void> {
  const url = `${API_BASE}/gov-insight/ai-report/save`;
  const token = localStorage.getItem('admin_token');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ org_id: orgId, org_name: orgName, year, content, model }),
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error(`Failed to save AI report: ${response.status}`);
  }

  const result: ApiResponse<any> = await response.json();
  if (result.code !== 200) {
    throw new Error(result.msg || 'Unknown error');
  }
}

/**
 * 获取 AI 辅助决策报告
 */
export async function fetchAIReport(
  orgId: string,
  year: number
): Promise<GovInsightAIReportRecord | null> {
  const params = new URLSearchParams();
  params.set('org_id', orgId);
  params.set('year', String(year));

  const url = `${API_BASE}/gov-insight/ai-report?${params.toString()}`;
  const response = await fetch(url, { credentials: 'include' });

  if (!response.ok) {
    throw new Error(`Failed to fetch AI report: ${response.status}`);
  }

  const result: ApiResponse<any> = await response.json();
  if (result.code !== 200 || !result.data) {
    return null;
  }

  return result.data;
}
export async function fetchAIReportReplayContext(
  orgId: string,
  year: number
): Promise<GovInsightAIReportReplayContext | null> {
  const params = new URLSearchParams();
  params.set('org_id', orgId);
  params.set('year', String(year));

  const url = `${API_BASE}/gov-insight/ai-report/replay?${params.toString()}`;
  const token = localStorage.getItem('admin_token');
  const response = await fetch(url, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch AI report replay context: ${response.status}`);
  }

  const result: ApiResponse<GovInsightAIReportReplayContext | null> = await response.json();
  if (result.code !== 200 || !result.data) {
    return null;
  }

  return result.data;
}

/**
 * 获取后端 report_payload_v1
 */
export async function fetchAIReportPayload(
  orgId: string,
  year: number
): Promise<GovInsightBackendReportPayload | null> {
  const params = new URLSearchParams();
  params.set('org_id', orgId);
  params.set('year', String(year));

  const url = `${API_BASE}/gov-insight/ai-report/payload?${params.toString()}`;
  const token = localStorage.getItem('admin_token');
  const response = await fetch(url, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch AI report payload: ${response.status}`);
  }

  const result: ApiResponse<GovInsightBackendReportPayload | null> = await response.json();
  if (result.code !== 200 || !result.data) {
    return null;
  }

  return result.data;
}

/**
 * 获取年度报告原文摘要
 */
export async function fetchAnnualReportSummary(
  orgId: string,
  year: number
): Promise<AnnualReportSummary | null> {
  const params = new URLSearchParams();
  params.set('org_id', orgId);
  params.set('year', String(year));

  const url = `${API_BASE}/gov-insight/annual-report-summary?${params.toString()}`;
  const response = await fetch(url, { credentials: 'include' });

  if (!response.ok) {
    throw new Error(`Failed to fetch annual report summary: ${response.status}`);
  }

  const result: ApiResponse<AnnualReportSummary | null> = await response.json();
  if (result.code !== 200 || !result.data) {
    return null;
  }

  return result.data;
}

export async function fetchLeaderCockpitModel(
  orgId: string,
  year: number
): Promise<LeaderCockpitModel | null> {
  const params = new URLSearchParams();
  params.set('org_id', orgId);
  params.set('year', String(year));

  const url = `${API_BASE}/gov-insight/leader-cockpit/model?${params.toString()}`;
  const token = localStorage.getItem('admin_token');
  const response = await fetch(url, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch leader cockpit model: ${response.status}`);
  }

  const result: ApiResponse<LeaderCockpitModel | null> = await response.json();
  if (result.code !== 200 || !result.data) {
    return null;
  }

  return result.data;
}

export async function fetchLeaderCockpitComparison(
  orgId: string,
  year: number,
  viewLevel: Exclude<ViewLevel, 'city'>,
  calibration: {
    disclosureMethod: DisclosureMethod;
    correctionMethod: CorrectionMethod;
    includesCarryOver: boolean;
    enableStableSample: boolean;
  }
): Promise<EntityComparisonModel | null> {
  const params = new URLSearchParams();
  params.set('org_id', orgId);
  params.set('year', String(year));
  params.set('view_level', viewLevel);
  params.set('disclosure_method', calibration.disclosureMethod);
  params.set('correction_method', calibration.correctionMethod);
  params.set('includes_carry_over', calibration.includesCarryOver ? 'true' : 'false');
  params.set('enable_stable_sample', calibration.enableStableSample ? 'true' : 'false');

  const url = `${API_BASE}/gov-insight/leader-cockpit/comparison?${params.toString()}`;
  const token = localStorage.getItem('admin_token');
  const response = await fetch(url, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch leader cockpit comparison model: ${response.status}`);
  }

  const result: ApiResponse<EntityComparisonModel | null> = await response.json();
  if (result.code !== 200 || !result.data) {
    return null;
  }

  return result.data;
}
