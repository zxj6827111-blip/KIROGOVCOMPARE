/**
 * GovInsight API Client
 * 政务公开智慧治理大屏数据请求封装
 */

import type { AnnualDataRecord, OrgItem, ApiResponse } from './types';

const API_BASE = process.env.REACT_APP_API_URL || '';

/**
 * 获取年度统计数据
 * @param year 年份 (可选)
 * @param orgId 单位ID (可选)
 */
export async function fetchAnnualData(
  year?: number,
  orgId?: string
): Promise<AnnualDataRecord[]> {
  const params = new URLSearchParams();
  if (year) params.set('year', String(year));
  if (orgId) params.set('org_id', orgId);

  const url = `${API_BASE}/api/gov-insight/annual-data${params.toString() ? '?' + params.toString() : ''}`;
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
  const url = `${API_BASE}/api/gov-insight/years`;
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
 * @param year 年份 (可选, 用于过滤特定年份的单位)
 */
export async function fetchOrgs(year?: number): Promise<OrgItem[]> {
  const params = new URLSearchParams();
  if (year) params.set('year', String(year));

  const url = `${API_BASE}/api/gov-insight/orgs${params.toString() ? '?' + params.toString() : ''}`;
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
