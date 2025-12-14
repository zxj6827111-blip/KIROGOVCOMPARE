/**
 * ParsedDataStorageService 单元测试
 * 测试解析数据的保存、读取、删除等功能
 */

import * as fs from 'fs';
import * as path from 'path';
import ParsedDataStorageService from '../ParsedDataStorageService';
import { StructuredDocument } from '../../types/models';

describe('ParsedDataStorageService', () => {
  const testStoragePath = path.join(__dirname, '../../../test_storage');
  const testAssetId = `test_asset_${Date.now()}`;

  // 创建测试用的存储服务实例
  const storageService = new (ParsedDataStorageService.constructor as any)(testStoragePath);

  // 测试数据
  const testDocument: StructuredDocument = {
    documentId: `doc_${testAssetId}`,
    assetId: testAssetId,
    title: '测试文档',
    sections: [
      {
        id: 'sec1',
        level: 1,
        title: '一、测试章节',
        content: [
          {
            id: 'para1',
            text: '这是测试内容',
            type: 'normal',
          },
        ],
        tables: [
          {
            id: 'table1',
            title: '测试表格',
            rows: [
              {
                id: 'row1',
                rowIndex: 0,
                cells: [
                  {
                    id: 'cell1',
                    rowIndex: 0,
                    colIndex: 0,
                    content: '单元格内容',
                  },
                ],
              },
            ],
            columns: 1,
          },
        ],
        subsections: [],
      },
    ],
    metadata: {
      totalPages: 1,
      extractedAt: new Date(),
      parseVersion: '2.0',
    },
  };

  beforeAll(() => {
    // 确保测试存储目录存在
    if (!fs.existsSync(testStoragePath)) {
      fs.mkdirSync(testStoragePath, { recursive: true });
    }
  });

  afterAll(() => {
    // 清理测试数据
    if (fs.existsSync(testStoragePath)) {
      const files = fs.readdirSync(testStoragePath);
      files.forEach(file => {
        fs.unlinkSync(path.join(testStoragePath, file));
      });
      fs.rmdirSync(testStoragePath);
    }
  });

  describe('saveParseData', () => {
    it('应该能保存解析数据到文件系统', async () => {
      const filePath = await storageService.saveParseData(testAssetId, testDocument);

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('保存的文件应该包含正确的 JSON 数据', async () => {
      await storageService.saveParseData(testAssetId, testDocument);

      const filePath = path.join(testStoragePath, `${testAssetId}.json`);
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      expect(data.assetId).toBe(testAssetId);
      expect(data.title).toBe('测试文档');
      expect(data.sections.length).toBe(1);
    });

    it('应该能覆盖已存在的文件', async () => {
      const newDocument = { ...testDocument, title: '更新的文档' };
      await storageService.saveParseData(testAssetId, testDocument);
      await storageService.saveParseData(testAssetId, newDocument);

      const filePath = path.join(testStoragePath, `${testAssetId}.json`);
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      expect(data.title).toBe('更新的文档');
    });
  });

  describe('loadParseData', () => {
    it('应该能读取已保存的解析数据', async () => {
      await storageService.saveParseData(testAssetId, testDocument);
      const loadedData = await storageService.loadParseData(testAssetId);

      expect(loadedData).toBeDefined();
      expect(loadedData?.assetId).toBe(testAssetId);
      expect(loadedData?.title).toBe('测试文档');
    });

    it('读取不存在的数据应该返回 null', async () => {
      const nonExistentId = `non_existent_${Date.now()}`;
      const loadedData = await storageService.loadParseData(nonExistentId);

      expect(loadedData).toBeNull();
    });

    it('应该能正确解析 JSON 数据', async () => {
      await storageService.saveParseData(testAssetId, testDocument);
      const loadedData = await storageService.loadParseData(testAssetId);

      expect(loadedData?.sections).toBeDefined();
      expect(loadedData?.sections.length).toBe(1);
      expect(loadedData?.sections[0].title).toBe('一、测试章节');
    });
  });

  describe('deleteParseData', () => {
    it('应该能删除已保存的解析数据', async () => {
      const deleteTestId = `delete_test_${Date.now()}`;
      await storageService.saveParseData(deleteTestId, testDocument);

      const filePath = path.join(testStoragePath, `${deleteTestId}.json`);
      expect(fs.existsSync(filePath)).toBe(true);

      await storageService.deleteParseData(deleteTestId);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('删除不存在的数据不应该抛出错误', async () => {
      const nonExistentId = `non_existent_delete_${Date.now()}`;
      expect(async () => {
        await storageService.deleteParseData(nonExistentId);
      }).not.toThrow();
    });
  });

  describe('hasParseData', () => {
    it('存在的数据应该返回 true', async () => {
      const hasTestId = `has_test_${Date.now()}`;
      await storageService.saveParseData(hasTestId, testDocument);

      const exists = await storageService.hasParseData(hasTestId);
      expect(exists).toBe(true);

      await storageService.deleteParseData(hasTestId);
    });

    it('不存在的数据应该返回 false', async () => {
      const nonExistentId = `non_existent_has_${Date.now()}`;
      const exists = await storageService.hasParseData(nonExistentId);

      expect(exists).toBe(false);
    });
  });

  describe('getParseDataSize', () => {
    it('应该能获取文件大小', async () => {
      const sizeTestId = `size_test_${Date.now()}`;
      await storageService.saveParseData(sizeTestId, testDocument);

      const size = await storageService.getParseDataSize(sizeTestId);
      expect(size).toBeGreaterThan(0);

      await storageService.deleteParseData(sizeTestId);
    });

    it('不存在的文件大小应该返回 0', async () => {
      const nonExistentId = `non_existent_size_${Date.now()}`;
      const size = await storageService.getParseDataSize(nonExistentId);

      expect(size).toBe(0);
    });
  });

  describe('getParseDataModifiedTime', () => {
    it('应该能获取文件修改时间', async () => {
      const timeTestId = `time_test_${Date.now()}`;
      await storageService.saveParseData(timeTestId, testDocument);

      const modTime = await storageService.getParseDataModifiedTime(timeTestId);
      expect(modTime).toBeDefined();
      expect(modTime instanceof Date).toBe(true);

      await storageService.deleteParseData(timeTestId);
    });

    it('不存在的文件修改时间应该返回 null', async () => {
      const nonExistentId = `non_existent_time_${Date.now()}`;
      const modTime = await storageService.getParseDataModifiedTime(nonExistentId);

      expect(modTime).toBeNull();
    });
  });

  describe('getStorageStats', () => {
    it('应该能获取存储统计信息', async () => {
      const statsTestId1 = `stats_test_1_${Date.now()}`;
      const statsTestId2 = `stats_test_2_${Date.now()}`;

      await storageService.saveParseData(statsTestId1, testDocument);
      await storageService.saveParseData(statsTestId2, testDocument);

      const stats = await storageService.getStorageStats();

      expect(stats.totalFiles).toBeGreaterThanOrEqual(2);
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.files).toBeDefined();
      expect(Array.isArray(stats.files)).toBe(true);

      await storageService.deleteParseData(statsTestId1);
      await storageService.deleteParseData(statsTestId2);
    });

    it('空存储应该返回 0 个文件', async () => {
      const emptyStoragePath = path.join(__dirname, '../../../empty_storage');
      const emptyService = new (ParsedDataStorageService.constructor as any)(emptyStoragePath);

      const stats = await emptyService.getStorageStats();

      expect(stats.totalFiles).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.files.length).toBe(0);
    });
  });

  describe('clearAllParseData', () => {
    it('应该能清理所有解析数据', async () => {
      const clearTestId1 = `clear_test_1_${Date.now()}`;
      const clearTestId2 = `clear_test_2_${Date.now()}`;

      await storageService.saveParseData(clearTestId1, testDocument);
      await storageService.saveParseData(clearTestId2, testDocument);

      let stats = await storageService.getStorageStats();
      expect(stats.totalFiles).toBeGreaterThanOrEqual(2);

      await storageService.clearAllParseData();

      stats = await storageService.getStorageStats();
      expect(stats.totalFiles).toBe(0);
    });
  });
});
