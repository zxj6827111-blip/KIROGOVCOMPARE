import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { ReportAsset } from '../models';
import StorageService from './StorageService';
import ParsedDataStorageService from './ParsedDataStorageService';

export interface QueryOptions {
  year?: number;
  region?: string;
  department?: string;
  status?: 'usable' | 'unusable';
  page?: number;
  limit?: number;
}

export interface QueryResult {
  assets: ReportAsset[];
  total: number;
  page: number;
}

export class AssetService {
  async getAssetById(assetId: string): Promise<ReportAsset | null> {
    try {
      const result = await pool.query('SELECT * FROM report_assets WHERE asset_id = $1', [
        assetId,
      ]);
      if (result.rows.length > 0) {
        return this.rowToAsset(result.rows[0]);
      }
    } catch (error) {
      console.error('查询资产失败:', error);
    }
    return null;
  }

  async queryAssets(options: QueryOptions): Promise<QueryResult> {
    try {
      let query = 'SELECT * FROM report_assets WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      if (options.year !== undefined) {
        query += ` AND year = $${paramIndex}`;
        params.push(options.year);
        paramIndex++;
      }

      if (options.region) {
        query += ` AND region = $${paramIndex}`;
        params.push(options.region);
        paramIndex++;
      }

      if (options.department) {
        query += ` AND department = $${paramIndex}`;
        params.push(options.department);
        paramIndex++;
      }

      if (options.status) {
        query += ` AND status = $${paramIndex}`;
        params.push(options.status);
        paramIndex++;
      }

      // 获取总数
      const countResult = await pool.query(
        `SELECT COUNT(*) as total FROM (${query}) as t`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      // 分页
      const page = options.page || 1;
      const limit = options.limit || 20;
      const offset = (page - 1) * limit;

      query += ` ORDER BY uploaded_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      const result = await pool.query(query, params);
      const assets = result.rows.map((row) => this.rowToAsset(row));

      return { assets, total, page };
    } catch (error) {
      console.error('查询资产列表失败:', error);
      return { assets: [], total: 0, page: 1 };
    }
  }

  async updateAssetMetadata(
    assetId: string,
    metadata: {
      year?: number;
      region?: string;
      department?: string;
      reportType?: string;
      tags?: string[];
    }
  ): Promise<ReportAsset | null> {
    try {
      const asset = await this.getAssetById(assetId);
      if (!asset) {
        return null;
      }

      const updates: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (metadata.year !== undefined) {
        updates.push(`year = $${paramIndex}`);
        params.push(metadata.year);
        paramIndex++;
      }

      if (metadata.region !== undefined) {
        updates.push(`region = $${paramIndex}`);
        params.push(metadata.region);
        paramIndex++;
      }

      if (metadata.department !== undefined) {
        updates.push(`department = $${paramIndex}`);
        params.push(metadata.department);
        paramIndex++;
      }

      if (metadata.reportType !== undefined) {
        updates.push(`report_type = $${paramIndex}`);
        params.push(metadata.reportType);
        paramIndex++;
      }

      if (metadata.tags !== undefined) {
        updates.push(`tags = $${paramIndex}`);
        params.push(metadata.tags);
        paramIndex++;
      }

      if (updates.length === 0) {
        return asset;
      }

      updates.push(`updated_at = $${paramIndex}`);
      params.push(new Date());
      params.push(assetId);

      const query = `
        UPDATE report_assets
        SET ${updates.join(', ')}
        WHERE asset_id = $${paramIndex + 1}
        RETURNING *
      `;

      const result = await pool.query(query, params);
      if (result.rows.length > 0) {
        return this.rowToAsset(result.rows[0]);
      }
    } catch (error) {
      console.error('更新资产元数据失败:', error);
    }
    return null;
  }

  async markAssetUnusable(assetId: string, reason: string): Promise<boolean> {
    try {
      const result = await pool.query(
        `
        UPDATE report_assets
        SET status = 'unusable', unusable_reason = $1, updated_at = $2
        WHERE asset_id = $3
        `,
        [reason, new Date(), assetId]
      );
      return result.rowCount! > 0;
    } catch (error) {
      console.error('标记资产不可用失败:', error);
      return false;
    }
  }

  async createAssetVersion(
    originalAssetId: string,
    newAssetData: Partial<ReportAsset>
  ): Promise<ReportAsset | null> {
    try {
      const originalAsset = await this.getAssetById(originalAssetId);
      if (!originalAsset) {
        return null;
      }

      const newAssetId = `asset_${uuidv4()}`;
      const newRevision = (originalAsset.revision || 0) + 1;
      const versionGroupId = originalAsset.versionGroupId || originalAssetId;

      const newAsset = new ReportAsset({
        ...originalAsset,
        ...newAssetData,
        assetId: newAssetId,
        revision: newRevision,
        versionGroupId,
        supersedesAssetId: originalAssetId,
        uploadedAt: new Date(),
        updatedAt: new Date(),
      });

      await this.saveAssetToDatabase(newAsset);
      return newAsset;
    } catch (error) {
      console.error('创建资产版本失败:', error);
      return null;
    }
  }

  async deleteAsset(assetId: string): Promise<boolean> {
    try {
      const asset = await this.getAssetById(assetId);
      if (!asset) {
        return false;
      }

      // 检查是否被任务引用
      const refResult = await pool.query(
        `
        SELECT COUNT(*) as count FROM compare_tasks
        WHERE asset_id_a = $1 OR asset_id_b = $1
        `,
        [assetId]
      );

      if (parseInt(refResult.rows[0].count) > 0) {
        console.warn(`资产 ${assetId} 仍被任务引用，无法删除`);
        return false;
      }

      // 删除文件
      await StorageService.deleteFile(asset.storagePath);

      // 删除数据库记录
      const result = await pool.query('DELETE FROM report_assets WHERE asset_id = $1', [
        assetId,
      ]);

      return result.rowCount! > 0;
    } catch (error) {
      console.error('删除资产失败:', error);
      return false;
    }
  }

  async getAssetContent(assetId: string): Promise<any | null> {
    try {
      const asset = await this.getAssetById(assetId);
      if (!asset) {
        return null;
      }

      // 返回资产的基本信息和元数据
      // 注意：这里只返回元数据，实际的解析内容应该从 structuredDataPath 读取
      return {
        assetId: asset.assetId,
        fileName: asset.fileName,
        fileHash: asset.fileHash,
        fileSize: asset.fileSize,
        year: asset.year,
        region: asset.region,
        department: asset.department,
        reportType: asset.reportType,
        tags: asset.tags,
        status: asset.status,
        revision: asset.revision,
        uploadedAt: asset.uploadedAt,
        updatedAt: asset.updatedAt,
        parseVersion: asset.parseVersion,
        structuredDataPath: asset.structuredDataPath,
      };
    } catch (error) {
      console.error('获取资产内容失败:', error);
      return null;
    }
  }

  async getAssetParseData(assetId: string): Promise<any | null> {
    try {
      const asset = await this.getAssetById(assetId);
      if (!asset) {
        return null;
      }

      // 从存储中读取解析数据
      const parseData = await ParsedDataStorageService.loadParseData(assetId);
      return parseData;
    } catch (error) {
      console.error('获取资产解析数据失败:', error);
      return null;
    }
  }

  private async saveAssetToDatabase(asset: ReportAsset): Promise<void> {
    const query = `
      INSERT INTO report_assets (
        asset_id, file_name, file_hash, file_size, storage_path,
        source_type, source_url, year, region, department, report_type, tags,
        status, unusable_reason, version_group_id, revision, supersedes_asset_id,
        parse_version, structured_data_path, owner_id, tenant_id, visibility,
        shared_to, uploaded_by, uploaded_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
    `;
    await pool.query(query, [
      asset.assetId,
      asset.fileName,
      asset.fileHash,
      asset.fileSize,
      asset.storagePath,
      asset.sourceType,
      asset.sourceUrl,
      asset.year,
      asset.region,
      asset.department,
      asset.reportType,
      asset.tags,
      asset.status,
      asset.unusableReason,
      asset.versionGroupId,
      asset.revision,
      asset.supersedesAssetId,
      asset.parseVersion,
      asset.structuredDataPath,
      asset.ownerId,
      asset.tenantId,
      asset.visibility,
      asset.sharedTo,
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

export default new AssetService();
