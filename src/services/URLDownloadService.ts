import axios, { AxiosError } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { validateURLSecurity, validateRedirectURL } from '../utils/urlValidator';
import StorageService from './StorageService';
import { calculateFileHash } from '../utils/fileHash';
import pool from '../config/database';
import { ReportAsset } from '../models';

const MAX_REDIRECTS = 5;
const CONNECT_TIMEOUT = 10000; // 10秒
const READ_TIMEOUT = 30000; // 30秒
const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024; // 100MB

export interface DownloadResult {
  success: boolean;
  assetId?: string;
  fileHash?: string;
  filePath?: string;
  error?: string;
  isDuplicate?: boolean;
  duplicateAssetId?: string;
}

export class URLDownloadService {
  async downloadFile(
    urlString: string,
    userId: string,
    metadata?: {
      year?: number;
      region?: string;
      department?: string;
      reportType?: string;
      tags?: string[];
    }
  ): Promise<DownloadResult> {
    try {
      // 验证URL安全性
      const validation = await validateURLSecurity(urlString);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // 下载文件
      const downloadResult = await this.downloadFileWithRedirectHandling(urlString);
      if (!downloadResult.success) {
        return { success: false, error: downloadResult.error };
      }

      const { filePath, fileName, contentType } = downloadResult;

      // 验证内容类型
      if (!contentType?.includes('application/pdf')) {
        fs.unlinkSync(filePath!);
        return { success: false, error: 'URL必须指向PDF文件' };
      }

      // 计算文件哈希
      const fileHash = await calculateFileHash(filePath!);

      // 检查是否已存在相同哈希的文件
      const existingAsset = await this.findAssetByHash(fileHash);
      if (existingAsset) {
        fs.unlinkSync(filePath!);
        return {
          success: true,
          assetId: existingAsset.assetId,
          fileHash,
          isDuplicate: true,
          duplicateAssetId: existingAsset.assetId,
        };
      }

      // 保存文件到存储
      const storageResult = await StorageService.saveFile(filePath!, `${uuidv4()}.pdf`, 'assets');
      if (!storageResult.success) {
        fs.unlinkSync(filePath!);
        return { success: false, error: storageResult.error };
      }

      // 清理临时文件
      fs.unlinkSync(filePath!);

      // 创建资产记录
      const assetId = `asset_${uuidv4()}`;
      const fileSize = await StorageService.getFileSize(storageResult.path!);
      const asset = new ReportAsset({
        assetId,
        fileName,
        fileHash,
        fileSize,
        storagePath: storageResult.path!,
        sourceType: 'url',
        sourceUrl: urlString,
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
        filePath: storageResult.path,
      };
    } catch (error) {
      return { success: false, error: `URL下载失败: ${error}` };
    }
  }

  private async downloadFileWithRedirectHandling(
    urlString: string,
    redirectCount: number = 0
  ): Promise<{
    success: boolean;
    filePath?: string;
    fileName?: string;
    contentType?: string;
    error?: string;
  }> {
    try {
      if (redirectCount > MAX_REDIRECTS) {
        return { success: false, error: 'URL重定向次数超限' };
      }

      const response = await axios.get(urlString, {
        timeout: CONNECT_TIMEOUT + READ_TIMEOUT,
        maxRedirects: 0,
        responseType: 'stream',
        headers: {
          'User-Agent': 'gov-report-diff/1.0',
        },
      });

      // 处理重定向
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const redirectURL = response.headers.location;
        if (!redirectURL) {
          return { success: false, error: '重定向URL缺失' };
        }

        // 验证重定向URL
        const redirectValidation = await validateRedirectURL(urlString, redirectURL);
        if (!redirectValidation.valid) {
          return { success: false, error: redirectValidation.error };
        }

        return this.downloadFileWithRedirectHandling(redirectURL, redirectCount + 1);
      }

      // 检查内容大小
      const contentLength = parseInt(response.headers['content-length'] || '0');
      if (contentLength > MAX_DOWNLOAD_SIZE) {
        return { success: false, error: `文件大小超过限制（最大${MAX_DOWNLOAD_SIZE / 1024 / 1024}MB）` };
      }

      // 保存到临时文件
      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFilePath = path.join(tempDir, `${uuidv4()}.pdf`);
      const writeStream = fs.createWriteStream(tempFilePath);

      let downloadedSize = 0;
      response.data.on('data', (chunk: Buffer) => {
        downloadedSize += chunk.length;
        if (downloadedSize > MAX_DOWNLOAD_SIZE) {
          writeStream.destroy();
          throw new Error('下载文件大小超过限制');
        }
      });

      return new Promise((resolve) => {
        response.data.pipe(writeStream);
        writeStream.on('finish', () => {
          const fileName = this.extractFileNameFromURL(urlString);
          resolve({
            success: true,
            filePath: tempFilePath,
            fileName,
            contentType: response.headers['content-type'],
          });
        });
        writeStream.on('error', (error) => {
          resolve({ success: false, error: `文件写入失败: ${error}` });
        });
      });
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.code === 'ECONNABORTED') {
        return { success: false, error: 'URL下载超时' };
      }
      return { success: false, error: `URL下载失败: ${error}` };
    }
  }

  private extractFileNameFromURL(urlString: string): string {
    try {
      const url = new URL(urlString);
      const pathname = url.pathname;
      const fileName = pathname.split('/').pop() || 'report.pdf';
      return fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
    } catch {
      return 'report.pdf';
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
        source_type, source_url, year, region, department, report_type, tags,
        status, owner_id, visibility, uploaded_by, uploaded_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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

export default new URLDownloadService();
