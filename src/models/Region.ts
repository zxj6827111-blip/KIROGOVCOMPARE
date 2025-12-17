// Region model definition

export interface Region {
  regionId: string;
  name: string;
  code?: string;
  level?: string;
  parentId?: string;
  status?: string;
  sortOrder?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateRegionInput {
  regionId: string;
  name: string;
  code?: string;
  level?: string;
  parentId?: string;
  status?: string;
  sortOrder?: number;
}

export interface UpdateRegionInput {
  name?: string;
  code?: string;
  level?: string;
  parentId?: string;
  status?: string;
  sortOrder?: number;
}

export const RegionModel = {
  create(input: CreateRegionInput): Region {
    const now = new Date();
    return {
      regionId: input.regionId,
      name: input.name,
      code: input.code,
      level: input.level,
      parentId: input.parentId,
      status: input.status ?? 'active',
      sortOrder: input.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    };
  },

  update(existing: Region, input: UpdateRegionInput): Region {
    return {
      ...existing,
      ...input,
      regionId: existing.regionId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
  },
};

export default RegionModel;
