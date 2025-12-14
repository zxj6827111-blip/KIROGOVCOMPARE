import { v4 as uuidv4 } from 'uuid';
import StorageService from './StorageService';
import { validatePDFFile } from '../utils/fileValidator';
import { calculateFileHash } from '../utils/fileHash';
import pool from '../config/database';
import { ReportAsset } from '../models';

export interface UploadResult {
  success: boolean;
  assetId?: string;
  fileHash?: string;
  error?: string;
  isDuplicate?: boolean;
  duplicateAssetId?: string;
}

export class FileUploadService {
  async uploadFile(
    filePath: string,
    fileName: string,
    userId: string,
    metadata?: {
      year?: number;
      region?: string;
      department?: string;
      reportType?: string;
      tags?: string[];
    }
  ): Promise<UploadResult> {
    try {
      // 获取文件大小
      const fileSize = await StorageService.getFileSize(filePath);

      // 验证PDF文件
      const validation = await validatePDFFile(filePath, fileName, fileSize);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // 计算文件哈希
      const fileHash = await calculateFileHash(filePath);

      // 检查是否已存在相同哈希的文件
      const existingAsset = await this.findAssetByHash(fileHash);
      if (existingAsset) {
        return {
          success: true,
          assetId: existingAsset.assetId,
          fileHash,
          isDuplicate: true,
          duplicateAssetId: existingAsset.assetId,
        };
      }

      // 保存文件到存储
      const storageResult = await StorageService.saveFile(filePath, `${uuidv4()}.pdf`, 'assets');
      if (!storageResult.success) {
        return { success: false, error: storageResult.error };
      }

      // 创建资产记录
      const assetId = `asset_${uuidv4()}`;
      const asset = new ReportAsset({
        assetId,
        fileName,
        fileHash,
        fileSize,
        storagePath: storageResult.path!,
        sourceType: 'upload',
        status: 'usable',
        ownerId: userId,
        visibility: 'private',
        uploadedBy: userId,
        uploadedAt: new Date(),
        updatedAt: new Date(),
        ...metadata,
      });

      // 保存到数据库
      await this.saveAssetToDatabase(asset);

      return {
        success: true,
        assetId,
        fileHash,
      };
    } catch (error) {
      return { success: false, error: `文件上传失败: ${error}` };
    }
  }

  private async findAssetByHash(fileHash: string): Promise<ReportAsset | null> {
    try {
      const result = await pool.query(
        'SELECT * FROM report_assets WHERE file_hash = $1 LIMIT 1',
        [fileHash]
      );
      if (result.rows.length > 0) {
        return this.rowToAsset(result.rows[0]);
      }
    } catch (error) {
      console.error('查询资产失败:', error);
    }
    return null;
  }

  private async saveAssetToDatabase(asset: ReportAsset): Promise<void> {
    const query = `
      INSERT INTO report_assets (
        asset_id, file_name, file_hash, file_size, storage_path,
        source_type, year, region, department, report_type, tags,
        status, owner_id, visibility, uploaded_by, uploaded_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `;
    await pool.query(query, [
      asset.assetId,
      asset.fileName,
      asset.fileHash,
      asset.fileSize,
      asset.storagePath,
      asset.sourceType,
      asset.year,
      asset.region,
      asset.department,
      asset.reportType,
      asset.tags,
      asset.status,
      asset.ownerId,
      asset.visibility,
      asset.uploadedBy,
      asset.uploadedAt,
      asset.updatedAt,
    ]);
  }

  private rowToAsset(row: any): ReportAsset {
    return new ReportAsset({
      assetId: row.asset_id,
      fileName: row.file_name,
      fileHash: row.file_hash,
      fileSize: row.file_size,
      storagePath: row.storage_path,
      sourceType: row.source_type,
      sourceUrl: row.source_url,
      year: row.year,
      region: row.region,
      department: row.department,
      reportType: row.report_type,
      tags: row.tags,
      status: row.status,
      unusableReason: row.unusable_reason,
      versionGroupId: row.version_group_id,
      revision: row.revision,
      supersedesAssetId: row.supersedes_asset_id,
      parseVersion: row.parse_version,
      structuredDataPath: row.structured_data_path,
      ownerId: row.owner_id,
      tenantId: row.tenant_id,
      visibility: row.visibility,
      sharedTo: row.shared_to,
      uploadedBy: row.uploaded_by,
      uploadedAt: new Date(row.uploaded_at),
      updatedAt: new Date(row.updated_at),
    });
  }
}

export default new FileUploadService();
