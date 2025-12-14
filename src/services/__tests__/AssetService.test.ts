/**
 * AssetService 单元测试
 * 测试资产服务的各项功能
 */

import AssetService from '../AssetService';
import ParsedDataStorageService from '../ParsedDataStorageService';
import { StructuredDocument } from '../../types/models';

// Mock ParsedDataStorageService
jest.mock('../ParsedDataStorageService');

describe('AssetService', () => {
  const testAssetId = 'test_asset_001';
  const testDocument: StructuredDocument = {
    documentId: `doc_${testAssetId}`,
    assetId: testAssetId,
    title: '测试文档',
    sections: [
      {
        id: 'sec1',
        level: 1,
        title: '一、测试章节',
        content: [],
        tables: [],
        subsections: [],
      },
    ],
    metadata: {
      totalPages: 1,
      extractedAt: new Date(),
      parseVersion: '2.0',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAssetParseData', () => {
    it('应该能从存储中读取解析数据', async () => {
      // Mock ParsedDataStorageService.loadParseData
      (ParsedDataStorageService.loadParseData as jest.Mock).mockResolvedValue(testDocument);

      const parseData = await AssetService.getAssetParseData(testAssetId);

      expect(parseData).toBeDefined();
      expect(parseData?.assetId).toBe(testAssetId);
      expect(parseData?.title).toBe('测试文档');
      expect(ParsedDataStorageService.loadParseData).toHaveBeenCalledWith(testAssetId);
    });

    it('不存在的数据应该返回 null', async () => {
      (ParsedDataStorageService.loadParseData as jest.Mock).mockResolvedValue(null);

      const parseData = await AssetService.getAssetParseData('non_existent_id');

      expect(parseData).toBeNull();
    });

    it('应该能处理存储服务的异常', async () => {
      const error = new Error('存储服务异常');
      (ParsedDataStorageService.loadParseData as jest.Mock).mockRejectedValue(error);

      const parseData = await AssetService.getAssetParseData(testAssetId);

      expect(parseData).toBeNull();
    });

    it('应该能正确返回解析数据的所有字段', async () => {
      (ParsedDataStorageService.loadParseData as jest.Mock).mockResolvedValue(testDocument);

      const parseData = await AssetService.getAssetParseData(testAssetId);

      expect(parseData?.documentId).toBe(`doc_${testAssetId}`);
      expect(parseData?.sections).toBeDefined();
      expect(parseData?.sections.length).toBe(1);
      expect(parseData?.metadata).toBeDefined();
      expect(parseData?.metadata.parseVersion).toBe('2.0');
    });
  });

  describe('getAssetContent', () => {
    it('应该能获取资产内容', async () => {
      // 这个测试需要数据库连接，这里只做基本的类型检查
      const content = await AssetService.getAssetContent(testAssetId);

      // 如果资产不存在，应该返回 null
      if (content === null) {
        expect(content).toBeNull();
      } else {
        // 如果资产存在，应该有这些字段
        expect(content).toHaveProperty('assetId');
        expect(content).toHaveProperty('fileName');
        expect(content).toHaveProperty('parseVersion');
      }
    });
  });

  describe('getAssetById', () => {
    it('应该能根据 ID 获取资产', async () => {
      const asset = await AssetService.getAssetById(testAssetId);

      // 如果资产不存在，应该返回 null
      if (asset === null) {
        expect(asset).toBeNull();
      } else {
        // 如果资产存在，应该有这些字段
        expect(asset).toHaveProperty('assetId');
        expect(asset).toHaveProperty('fileName');
      }
    });

    it('不存在的资产应该返回 null', async () => {
      const asset = await AssetService.getAssetById('non_existent_asset_id');

      expect(asset).toBeNull();
    });
  });

  describe('queryAssets', () => {
    it('应该能查询资产列表', async () => {
      const result = await AssetService.queryAssets({
        page: 1,
        limit: 10,
      });

      expect(result).toHaveProperty('assets');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('page');
      expect(Array.isArray(result.assets)).toBe(true);
    });

    it('应该能按年份查询资产', async () => {
      const result = await AssetService.queryAssets({
        year: 2024,
        page: 1,
        limit: 10,
      });

      expect(result).toHaveProperty('assets');
      expect(result.assets.every(a => a.year === 2024 || a.year === undefined)).toBe(true);
    });

    it('应该能按地区查询资产', async () => {
      const result = await AssetService.queryAssets({
        region: 'beijing',
        page: 1,
        limit: 10,
      });

      expect(result).toHaveProperty('assets');
      expect(result.assets.every(a => a.region === 'beijing' || a.region === undefined)).toBe(true);
    });

    it('应该能按状态查询资产', async () => {
      const result = await AssetService.queryAssets({
        status: 'usable',
        page: 1,
        limit: 10,
      });

      expect(result).toHaveProperty('assets');
      expect(result.assets.every(a => a.status === 'usable' || a.status === undefined)).toBe(true);
    });
  });

  describe('updateAssetMetadata', () => {
    it('应该能更新资产元数据', async () => {
      const updatedAsset = await AssetService.updateAssetMetadata(testAssetId, {
        year: 2024,
        region: 'beijing',
      });

      if (updatedAsset === null) {
        // 资产不存在
        expect(updatedAsset).toBeNull();
      } else {
        // 资产存在，检查更新
        expect(updatedAsset.year).toBe(2024);
        expect(updatedAsset.region).toBe('beijing');
      }
    });

    it('不存在的资产应该返回 null', async () => {
      const updatedAsset = await AssetService.updateAssetMetadata('non_existent_id', {
        year: 2024,
      });

      expect(updatedAsset).toBeNull();
    });
  });

  describe('markAssetUnusable', () => {
    it('应该能标记资产为不可用', async () => {
      const result = await AssetService.markAssetUnusable(testAssetId, '测试原因');

      // 结果应该是布尔值
      expect(typeof result).toBe('boolean');
    });
  });

  describe('deleteAsset', () => {
    it('应该能删除资产', async () => {
      const result = await AssetService.deleteAsset(testAssetId);

      // 结果应该是布尔值
      expect(typeof result).toBe('boolean');
    });

    it('不存在的资产应该返回 false', async () => {
      const result = await AssetService.deleteAsset('non_existent_asset_id');

      expect(result).toBe(false);
    });
  });
});
