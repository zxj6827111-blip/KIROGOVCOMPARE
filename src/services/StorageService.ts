import * as fs from 'fs';
import * as path from 'path';
import storageConfig from '../config/storage';
import { calculateFileHash } from '../utils/fileHash';

export interface StorageResult {
  success: boolean;
  path?: string;
  hash?: string;
  error?: string;
}

export class StorageService {
  async saveFile(
    sourceFilePath: string,
    fileName: string,
    subDir: string = 'assets'
  ): Promise<StorageResult> {
    try {
      if (storageConfig.type === 'local') {
        return this.saveFileLocal(sourceFilePath, fileName, subDir);
      } else if (storageConfig.type === 's3') {
        return this.saveFileS3(sourceFilePath, fileName, subDir);
      }
      return { success: false, error: '不支持的存储类型' };
    } catch (error) {
      return { success: false, error: `文件保存失败: ${error}` };
    }
  }

  private async saveFileLocal(
    sourceFilePath: string,
    fileName: string,
    subDir: string
  ): Promise<StorageResult> {
    try {
      const destDir = path.join(storageConfig.path!, subDir);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const destPath = path.join(destDir, fileName);
      fs.copyFileSync(sourceFilePath, destPath);

      const hash = await calculateFileHash(destPath);
      return {
        success: true,
        path: destPath,
        hash,
      };
    } catch (error) {
      return { success: false, error: `本地文件保存失败: ${error}` };
    }
  }

  private async saveFileS3(
    sourceFilePath: string,
    fileName: string,
    subDir: string
  ): Promise<StorageResult> {
    // TODO: 实现S3上传逻辑
    return { success: false, error: 'S3存储暂未实现' };
  }

  async deleteFile(filePath: string): Promise<boolean> {
    try {
      if (storageConfig.type === 'local') {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('文件删除失败:', error);
      return false;
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    if (storageConfig.type === 'local') {
      return fs.existsSync(filePath);
    }
    return false;
  }

  async getFileSize(filePath: string): Promise<number> {
    try {
      if (storageConfig.type === 'local') {
        const stats = fs.statSync(filePath);
        return stats.size;
      }
    } catch (error) {
      console.error('获取文件大小失败:', error);
    }
    return 0;
  }
}

export default new StorageService();
