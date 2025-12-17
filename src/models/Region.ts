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
  // Stub implementation
};

export default RegionModel;
