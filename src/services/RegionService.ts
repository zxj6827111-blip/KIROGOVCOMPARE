/**
 * 城市服务
 * 管理城市的 CRUD 操作和业务逻辑
 */

import { Region, CreateRegionInput, UpdateRegionInput, RegionModel } from '../models/Region';

// 模拟数据存储（实际应使用数据库）
const regionsStore = new Map<string, Region>();

// 初始化默认城市（4 级分类）
const initializeDefaultRegions = () => {
  const defaultRegions: Region[] = [
    // 省份级
    {
      regionId: 'beijing_prov',
      name: '北京市',
      level: 'province',
      status: 'active',
      sortOrder: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      regionId: 'shanghai_prov',
      name: '上海市',
      level: 'province',
      status: 'active',
      sortOrder: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    // 上海市下的地级市
    {
      regionId: 'huangpu_city',
      name: '黄浦区',
      level: 'city',
      parentId: 'shanghai_prov',
      status: 'active',
      sortOrder: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      regionId: 'guangdong_prov',
      name: '广东省',
      level: 'province',
      status: 'active',
      sortOrder: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    // 地级市
    {
      regionId: 'guangzhou_city',
      name: '广州市',
      level: 'city',
      parentId: 'guangdong_prov',
      status: 'active',
      sortOrder: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      regionId: 'shenzhen_city',
      name: '深圳市',
      level: 'city',
      parentId: 'guangdong_prov',
      status: 'active',
      sortOrder: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    // 县级市
    {
      regionId: 'chengdu_district',
      name: '成都市',
      level: 'district',
      parentId: 'sichuan_prov',
      status: 'active',
      sortOrder: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    // 街道乡镇
    {
      regionId: 'hangzhou_township',
      name: '杭州市',
      level: 'township',
      parentId: 'zhejiang_prov',
      status: 'active',
      sortOrder: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  defaultRegions.forEach(region => {
    regionsStore.set(region.regionId, region);
  });
};

// 初始化
initializeDefaultRegions();

export class RegionService {
  /**
   * 获取所有城市
   */
  static async getAllRegions(): Promise<Region[]> {
    const regions = Array.from(regionsStore.values());
    return regions.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  /**
   * 按 ID 获取城市
   */
  static async getRegionById(regionId: string): Promise<Region | null> {
    return regionsStore.get(regionId) || null;
  }

  /**
   * 创建城市
   */
  static async createRegion(input: CreateRegionInput): Promise<Region> {
    if (regionsStore.has(input.regionId)) {
      throw new Error(`城市 ${input.regionId} 已存在`);
    }

    const region = RegionModel.create(input);
    regionsStore.set(region.regionId, region);
    return region;
  }

  /**
   * 更新城市
   */
  static async updateRegion(regionId: string, input: UpdateRegionInput): Promise<Region> {
    const region = regionsStore.get(regionId);
    if (!region) {
      throw new Error(`城市 ${regionId} 不存在`);
    }

    const updated = RegionModel.update(region, input);
    regionsStore.set(regionId, updated);
    return updated;
  }

  /**
   * 删除城市
   */
  static async deleteRegion(regionId: string): Promise<void> {
    if (!regionsStore.has(regionId)) {
      throw new Error(`城市 ${regionId} 不存在`);
    }
    regionsStore.delete(regionId);
  }

  /**
   * 获取城市列表（分页）
   */
  static async getRegionsPaginated(
    page: number = 1,
    pageSize: number = 20
  ): Promise<{ regions: Region[]; total: number }> {
    const allRegions = await this.getAllRegions();
    const total = allRegions.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const regions = allRegions.slice(start, end);

    return { regions, total };
  }

  /**
   * 按级别获取地区
   */
  static async getRegionsByLevel(level: string): Promise<Region[]> {
    const regions = Array.from(regionsStore.values());
    return regions
      .filter(r => r.level === level)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  /**
   * 获取子地区（按父级 ID）
   */
  static async getChildRegions(parentId: string): Promise<Region[]> {
    const regions = Array.from(regionsStore.values());
    return regions
      .filter(r => r.parentId === parentId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  /**
   * 获取地区树（层级结构）
   */
  static async getRegionTree(): Promise<any[]> {
    const allRegions = Array.from(regionsStore.values());
    const provinces = allRegions.filter(r => r.level === 'province');

    return provinces.map(province => ({
      ...province,
      children: allRegions
        .filter(r => r.parentId === province.regionId)
        .map(city => ({
          ...city,
          children: allRegions.filter(r => r.parentId === city.regionId),
        })),
    }));
  }
}

export default RegionService;
