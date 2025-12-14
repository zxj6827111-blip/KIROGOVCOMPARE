/**
 * 资产查询服务
 * 用于查询城市与年报资产的关系
 * 关键规则：只返回 status=usable 的资产
 * 注意：现有 ReportAsset 模型使用 region 字段而不是 regionId
 */

import { ReportAsset } from '../models/ReportAsset';

// 模拟数据存储（实际应使用数据库）
const assetsStore: ReportAsset[] = [];

export class AssetQueryService {
  /**
   * 获取城市的所有 usable 年份
   * 关键：只基于 status=usable 的资产
   */
  static async getAvailableYearsByRegion(regionId: string): Promise<number[]> {
    const usableAssets = assetsStore.filter(
      asset => asset.region === regionId && asset.status === 'usable'
    );

    // 去重并排序（过滤掉 undefined）
    const years = Array.from(
      new Set(usableAssets.map(a => a.year).filter((y): y is number => y !== undefined))
    ).sort((a, b) => b - a);
    return years;
  }

  /**
   * 获取 (regionId, year) 的最新 usable 资产
   * 用于任务创建时选择资产
   */
  static async getLatestUsableAsset(
    regionId: string,
    year: number
  ): Promise<ReportAsset | null> {
    const candidates = assetsStore.filter(
      asset =>
        asset.region === regionId &&
        asset.year === year &&
        asset.status === 'usable'
    );

    if (candidates.length === 0) {
      return null;
    }

    // 按 uploadedAt 降序排列，返回最新的
    candidates.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    return candidates[0];
  }

  /**
   * 获取有 usable 资产的所有城市 ID
   */
  static async getRegionsWithUsableAssets(): Promise<string[]> {
    const usableAssets = assetsStore.filter(asset => asset.status === 'usable');
    const regionIds = Array.from(
      new Set(usableAssets.map(a => a.region).filter((r): r is string => r !== undefined))
    );
    return regionIds;
  }

  /**
   * 检查城市是否有 usable 资产
   */
  static async hasUsableAssets(regionId: string): Promise<boolean> {
    return assetsStore.some(
      asset => asset.region === regionId && asset.status === 'usable'
    );
  }

  /**
   * 获取所有资产（后台管理用）
   */
  static async getAllAssets(
    filters?: {
      regionId?: string;
      year?: number;
      status?: string;
      q?: string;
    },
    page: number = 1,
    pageSize: number = 20
  ): Promise<{ assets: ReportAsset[]; total: number }> {
    console.log('[AssetQueryService.getAllAssets] 开始查询，存储中的资产总数:', assetsStore.length);
    console.log('[AssetQueryService.getAllAssets] 过滤条件:', filters);
    
    let filtered = [...assetsStore];
    console.log('[AssetQueryService.getAllAssets] 复制后的资产数:', filtered.length);

    // 应用筛选条件
    if (filters?.regionId) {
      filtered = filtered.filter(a => a.region === filters.regionId);
      console.log('[AssetQueryService.getAllAssets] 按 regionId 过滤后:', filtered.length);
    }
    if (filters?.year) {
      filtered = filtered.filter(a => a.year === filters.year);
      console.log('[AssetQueryService.getAllAssets] 按 year 过滤后:', filtered.length);
    }
    if (filters?.status) {
      filtered = filtered.filter(a => a.status === filters.status);
      console.log('[AssetQueryService.getAllAssets] 按 status 过滤后:', filtered.length);
    }
    if (filters?.q) {
      const q = filters.q.toLowerCase();
      filtered = filtered.filter(
        a =>
          a.fileName.toLowerCase().includes(q) ||
          (a.region && a.region.toLowerCase().includes(q))
      );
      console.log('[AssetQueryService.getAllAssets] 按 q 过滤后:', filtered.length);
    }

    // 排序（默认按 uploadedAt 降序）
    filtered.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

    // 分页
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const assets = filtered.slice(start, end);

    console.log('[AssetQueryService.getAllAssets] 分页参数:', { page, pageSize, start, end, total });
    console.log('[AssetQueryService.getAllAssets] 返回的资产数:', assets.length);
    console.log('[AssetQueryService.getAllAssets] 返回的资产:', assets.map(a => ({ assetId: a.assetId, region: a.region, year: a.year })));

    return { assets, total };
  }

  /**
   * 按 ID 获取单个资产
   */
  static getAssetById(assetId: string): ReportAsset | undefined {
    return assetsStore.find(a => a.assetId === assetId);
  }

  /**
   * 同步获取所有资产（不分页）
   */
  static getAllAssetsSync(): ReportAsset[] {
    return [...assetsStore];
  }

  /**
   * 添加资产到存储（用于测试）
   */
  static addAsset(asset: ReportAsset): void {
    console.log('[AssetQueryService] 添加资产:', {
      assetId: asset.assetId,
      region: asset.region,
      year: asset.year,
      fileName: asset.fileName,
      status: asset.status,
    });
    assetsStore.push(asset);
    console.log('[AssetQueryService] 当前存储中的资产总数:', assetsStore.length);
  }

  /**
   * 删除资产
   */
  static deleteAsset(assetId: string): boolean {
    const index = assetsStore.findIndex(a => a.assetId === assetId);
    if (index !== -1) {
      console.log('[AssetQueryService] 删除资产:', assetId);
      assetsStore.splice(index, 1);
      console.log('[AssetQueryService] 删除后的资产总数:', assetsStore.length);
      return true;
    }
    console.log('[AssetQueryService] 资产不存在:', assetId);
    return false;
  }

  /**
   * 清空存储（用于测试）
   */
  static clearAssets(): void {
    assetsStore.length = 0;
  }

  /**
   * 获取统计数据
   */
  static async getSummary(): Promise<{
    totalRegions: number;
    regionsWithAssets: number;
    totalAssets: number;
    assetsByStatus: Record<string, number>;
    assetsByYear: Record<number, number>;
  }> {
    const usableAssets = assetsStore.filter(a => a.status === 'usable');
    const regionsWithAssets = new Set(
      usableAssets.map(a => a.region).filter((r): r is string => r !== undefined)
    ).size;

    const assetsByStatus: Record<string, number> = {};
    assetsStore.forEach(asset => {
      assetsByStatus[asset.status] = (assetsByStatus[asset.status] || 0) + 1;
    });

    const assetsByYear: Record<number, number> = {};
    assetsStore.forEach(asset => {
      if (asset.year !== undefined) {
        assetsByYear[asset.year] = (assetsByYear[asset.year] || 0) + 1;
      }
    });

    return {
      totalRegions: 6, // 硬编码，实际应从 regions 表获取
      regionsWithAssets,
      totalAssets: assetsStore.length,
      assetsByStatus,
      assetsByYear,
    };
  }
}

export default AssetQueryService;
