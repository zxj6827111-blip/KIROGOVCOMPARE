export interface ReportAsset {
  assetId: string;
  fileName: string;
  fileHash: string;
  fileSize: number;
  storagePath: string;
  sourceType: 'upload' | 'url';
  sourceUrl?: string;
  year?: number;
  region?: string;
  department?: string;
  reportType?: string;
  tags?: string[];
  status: 'usable' | 'unusable';
  unusableReason?: string;
  versionGroupId?: string;
  revision?: number;
  supersedesAssetId?: string;
  parseVersion?: string;
  structuredDataPath?: string;
  ownerId: string;
  tenantId?: string;
  visibility: 'private' | 'org' | 'public';
  sharedTo?: string[];
  uploadedBy: string;
  uploadedAt: Date;
  updatedAt: Date;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  score: number;
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  location?: string;
  relatedValues?: {
    expected: string | number;
    actual: string | number;
    details?: string;
  };
  evidence?: {
    paths: string[];
    values: Record<string, any>;
  };
}
