/**
 * 城市（区域）模型
 * 支持 4 级分类：省份、地级市、县级市、街道乡镇
 */

export type RegionLevel = 'province' | 'city' | 'district' | 'township';

export interface Region {
  regionId: string;           // 主键，如 "beijing"
  name: string;               // 城市名，如 "北京市"
  level: RegionLevel;         // 级别：province/city/district/township
  parentId?: string;          // 父级 ID（用于构建层级关系）
  status: 'active' | 'inactive';
  sortOrder: number;          // 排序
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRegionInput {
  regionId: string;
  name: string;
  level: RegionLevel;
  parentId?: string;
  status?: 'active' | 'inactive';
  sortOrder?: number;
}

export interface UpdateRegionInput {
  name?: string;
  level?: RegionLevel;
  parentId?: string;
  status?: 'active' | 'inactive';
  sortOrder?: number;
}

export class RegionModel {
  static create(input: CreateRegionInput): Region {
    return {
      regionId: input.regionId,
      name: input.name,
      level: input.level,
      parentId: input.parentId,
      status: input.status || 'active',
      sortOrder: input.sortOrder || 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  static update(region: Region, input: UpdateRegionInput): Region {
    return {
      ...region,
      name: input.name ?? region.name,
      level: input.level ?? region.level,
      parentId: input.parentId ?? region.parentId,
      status: input.status ?? region.status,
      sortOrder: input.sortOrder ?? region.sortOrder,
      updatedAt: new Date(),
    };
  }
}
