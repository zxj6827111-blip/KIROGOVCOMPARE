import { ReportAsset as IReportAsset } from '../types/models';

export class ReportAsset implements IReportAsset {
  assetId: string = '';
  fileName: string = '';
  fileHash: string = '';
  fileSize: number = 0;
  storagePath: string = '';
  sourceType: 'upload' | 'url' = 'upload';
  sourceUrl?: string;
  year?: number;
  region?: string;
  department?: string;
  reportType?: string;
  tags?: string[];
  status: 'usable' | 'unusable' = 'usable';
  unusableReason?: string;
  versionGroupId?: string;
  revision?: number;
  supersedesAssetId?: string;
  parseVersion?: string;
  structuredDataPath?: string;
  ownerId: string = '';
  tenantId?: string;
  visibility: 'private' | 'org' | 'public' = 'private';
  sharedTo?: string[];
  uploadedBy: string = '';
  uploadedAt: Date = new Date();
  updatedAt: Date = new Date();

  constructor(data: Partial<IReportAsset>) {
    Object.assign(this, data);
  }

  isUsable(): boolean {
    return this.status === 'usable';
  }

  isLatestVersion(): boolean {
    return !this.supersedesAssetId;
  }

  canBeAccessedBy(userId: string, userTenantId?: string): boolean {
    if (this.visibility === 'public') return true;
    if (this.ownerId === userId) return true;
    if (this.visibility === 'org' && this.tenantId === userTenantId) return true;
    if (this.sharedTo?.includes(userId)) return true;
    return false;
  }
}
