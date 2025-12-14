/**
 * 解析数据存储服务
 * 用于保存和读取 PDF 解析后的数据
 */

import * as fs from 'fs';
import * as path from 'path';
import { StructuredDocument } from '../types/models';

export class ParsedDataStorageService {
  private storagePath: string;

  constructor(storagePath: string = path.join(__dirname, '../../uploads/parsed')) {
    this.storagePath = storagePath;
    this.ensureStorageDirectory();
  }

  /**
   * 确保存储目录存在
   */
  private ensureStorageDirectory(): void {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  /**
   * 获取解析数据文件路径
   */
  private getDataFilePath(assetId: string): string {
    return path.join(this.storagePath, `${assetId}.json`);
  }

  /**
   * 保存解析数据
   */
  async saveParseData(assetId: string, document: StructuredDocument): Promise<string> {
    try {
      const filePath = this.getDataFilePath(assetId);
      
      // 序列化文档
      const jsonData = JSON.stringify(document, null, 2);
      
      // 写入文件
      fs.writeFileSync(filePath, jsonData, 'utf-8');
      
      console.log(`✅ 解析数据已保存: ${filePath}`);
      
      return filePath;
    } catch (error) {
      console.error(`❌ 保存解析数据失败 (${assetId}):`, error);
      throw new Error(`Failed to save parse data for asset ${assetId}: ${error}`);
    }
  }

  /**
   * 读取解析数据
   */
  async loadParseData(assetId: string): Promise<StructuredDocument | null> {
    try {
      const filePath = this.getDataFilePath(assetId);
      
      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️ 解析数据文件不存在: ${filePath}`);
        return null;
      }
      
      // 读取文件
      const jsonData = fs.readFileSync(filePath, 'utf-8');
      
      // 解析 JSON
      const document = JSON.parse(jsonData) as StructuredDocument;
      
      console.log(`✅ 解析数据已读取: ${filePath}`);
      
      return document;
    } catch (error) {
      console.error(`❌ 读取解析数据失败 (${assetId}):`, error);
      throw new Error(`Failed to load parse data for asset ${assetId}: ${error}`);
    }
  }

  /**
   * 删除解析数据
   */
  async deleteParseData(assetId: string): Promise<void> {
    try {
      const filePath = this.getDataFilePath(assetId);
      
      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️ 解析数据文件不存在: ${filePath}`);
        return;
      }
      
      // 删除文件
      fs.unlinkSync(filePath);
      
      console.log(`✅ 解析数据已删除: ${filePath}`);
    } catch (error) {
      console.error(`❌ 删除解析数据失败 (${assetId}):`, error);
      throw new Error(`Failed to delete parse data for asset ${assetId}: ${error}`);
    }
  }

  /**
   * 检查解析数据是否存在
   */
  async hasParseData(assetId: string): Promise<boolean> {
    try {
      const filePath = this.getDataFilePath(assetId);
      return fs.existsSync(filePath);
    } catch (error) {
      console.error(`❌ 检查解析数据失败 (${assetId}):`, error);
      return false;
    }
  }

  /**
   * 获取解析数据的文件大小
   */
  async getParseDataSize(assetId: string): Promise<number> {
    try {
      const filePath = this.getDataFilePath(assetId);
      
      if (!fs.existsSync(filePath)) {
        return 0;
      }
      
      const stats = fs.statSync(filePath);
      return stats.size;
    } catch (error) {
      console.error(`❌ 获取解析数据大小失败 (${assetId}):`, error);
      return 0;
    }
  }

  /**
   * 获取解析数据的修改时间
   */
  async getParseDataModifiedTime(assetId: string): Promise<Date | null> {
    try {
      const filePath = this.getDataFilePath(assetId);
      
      if (!fs.existsSync(filePath)) {
        return null;
      }
      
      const stats = fs.statSync(filePath);
      return new Date(stats.mtime);
    } catch (error) {
      console.error(`❌ 获取解析数据修改时间失败 (${assetId}):`, error);
      return null;
    }
  }

  /**
   * 清理所有解析数据
   */
  async clearAllParseData(): Promise<void> {
    try {
      if (!fs.existsSync(this.storagePath)) {
        return;
      }
      
      const files = fs.readdirSync(this.storagePath);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.storagePath, file);
          fs.unlinkSync(filePath);
        }
      }
      
      console.log(`✅ 所有解析数据已清理`);
    } catch (error) {
      console.error(`❌ 清理解析数据失败:`, error);
      throw new Error(`Failed to clear parse data: ${error}`);
    }
  }

  /**
   * 获取存储统计信息
   */
  async getStorageStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    files: Array<{ assetId: string; size: number; modifiedTime: Date }>;
  }> {
    try {
      if (!fs.existsSync(this.storagePath)) {
        return {
          totalFiles: 0,
          totalSize: 0,
          files: [],
        };
      }
      
      const files = fs.readdirSync(this.storagePath);
      const fileStats: Array<{ assetId: string; size: number; modifiedTime: Date }> = [];
      let totalSize = 0;
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.storagePath, file);
          const stats = fs.statSync(filePath);
          const assetId = file.replace('.json', '');
          
          fileStats.push({
            assetId,
            size: stats.size,
            modifiedTime: new Date(stats.mtime),
          });
          
          totalSize += stats.size;
        }
      }
      
      return {
        totalFiles: fileStats.length,
        totalSize,
        files: fileStats,
      };
    } catch (error) {
      console.error(`❌ 获取存储统计信息失败:`, error);
      throw new Error(`Failed to get storage stats: ${error}`);
    }
  }
}

// 导出单例
export default new ParsedDataStorageService();
