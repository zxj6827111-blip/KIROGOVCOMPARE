/**
 * Assets API 集成测试
 * 测试资产相关的 API 端点
 */

import request from 'supertest';
import express from 'express';
import assetsRouter from '../assets';
import AssetService from '../../services/AssetService';
import ParsedDataStorageService from '../../services/ParsedDataStorageService';

// Mock 服务
jest.mock('../../services/AssetService');
jest.mock('../../services/ParsedDataStorageService');

describe('Assets API', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/assets', assetsRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/assets', () => {
    it('应该能获取资产列表', async () => {
      const mockAssets = [
        {
          assetId: 'asset_001',
          fileName: 'report_2024.pdf',
          year: 2024,
          region: 'beijing',
          status: 'usable',
          uploadedAt: new Date(),
        },
      ];

      (AssetService.queryAssets as jest.Mock).mockResolvedValue({
        assets: mockAssets,
        total: 1,
        page: 1,
      });

      const response = await request(app)
        .get('/api/v1/assets')
        .expect(200);

      expect(response.body).toHaveProperty('assets');
      expect(response.body.assets.length).toBe(1);
      expect(response.body.assets[0].assetId).toBe('asset_001');
    });

    it('应该能按年份过滤资产', async () => {
      (AssetService.queryAssets as jest.Mock).mockResolvedValue({
        assets: [],
        total: 0,
        page: 1,
      });

      await request(app)
        .get('/api/v1/assets?year=2024')
        .expect(200);

      expect(AssetService.queryAssets).toHaveBeenCalledWith(
        expect.objectContaining({ year: 2024 })
      );
    });

    it('应该能按地区过滤资产', async () => {
      (AssetService.queryAssets as jest.Mock).mockResolvedValue({
        assets: [],
        total: 0,
        page: 1,
      });

      await request(app)
        .get('/api/v1/assets?region=beijing')
        .expect(200);

      expect(AssetService.queryAssets).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'beijing' })
      );
    });
  });

  describe('GET /api/v1/assets/:assetId', () => {
    it('应该能获取资产详情', async () => {
      const mockAsset = {
        assetId: 'asset_001',
        fileName: 'report_2024.pdf',
        fileHash: 'hash123',
        fileSize: 1024,
        year: 2024,
        region: 'beijing',
        status: 'usable',
        uploadedAt: new Date(),
      };

      (AssetService.getAssetById as jest.Mock).mockResolvedValue(mockAsset);

      const response = await request(app)
        .get('/api/v1/assets/asset_001')
        .expect(200);

      expect(response.body).toHaveProperty('assetId', 'asset_001');
      expect(response.body).toHaveProperty('fileName', 'report_2024.pdf');
    });

    it('不存在的资产应该返回 404', async () => {
      (AssetService.getAssetById as jest.Mock).mockResolvedValue(null);

      await request(app)
        .get('/api/v1/assets/non_existent_id')
        .expect(404);
    });
  });

  describe('GET /api/v1/assets/:assetId/parse', () => {
    it('应该能获取解析数据', async () => {
      const mockAsset = {
        assetId: 'asset_001',
        fileName: 'report_2024.pdf',
        year: 2024,
        region: 'beijing',
        parseVersion: '2.0',
      };

      const mockParseData = {
        documentId: 'doc_asset_001',
        assetId: 'asset_001',
        title: '政府信息公开年度报告',
        sections: [
          {
            id: 'sec1',
            level: 1,
            title: '一、总体情况',
            content: [],
            tables: [],
            subsections: [],
          },
        ],
        metadata: {
          totalPages: 10,
          extractedAt: new Date(),
          parseVersion: '2.0',
        },
      };

      (AssetService.getAssetById as jest.Mock).mockResolvedValue(mockAsset);
      (AssetService.getAssetParseData as jest.Mock).mockResolvedValue(mockParseData);

      const response = await request(app)
        .get('/api/v1/assets/asset_001/parse')
        .expect(200);

      expect(response.body).toHaveProperty('assetId', 'asset_001');
      expect(response.body).toHaveProperty('parsedContent');
      expect(response.body.parsedContent).toHaveProperty('sections');
    });

    it('资产不存在应该返回 404', async () => {
      (AssetService.getAssetById as jest.Mock).mockResolvedValue(null);

      await request(app)
        .get('/api/v1/assets/non_existent_id/parse')
        .expect(404);
    });

    it('解析数据不存在应该返回 404', async () => {
      const mockAsset = {
        assetId: 'asset_001',
        fileName: 'report_2024.pdf',
      };

      (AssetService.getAssetById as jest.Mock).mockResolvedValue(mockAsset);
      (AssetService.getAssetParseData as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/assets/asset_001/parse')
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/v1/assets/:assetId/content', () => {
    it('应该能获取资产内容', async () => {
      const mockAsset = {
        assetId: 'asset_001',
        fileName: 'report_2024.pdf',
        year: 2024,
        region: 'beijing',
      };

      const mockContent = {
        assetId: 'asset_001',
        fileName: 'report_2024.pdf',
        year: 2024,
        region: 'beijing',
        parseVersion: '2.0',
      };

      (AssetService.getAssetById as jest.Mock).mockResolvedValue(mockAsset);
      (AssetService.getAssetContent as jest.Mock).mockResolvedValue(mockContent);

      const response = await request(app)
        .get('/api/v1/assets/asset_001/content')
        .expect(200);

      expect(response.body).toHaveProperty('assetId', 'asset_001');
      expect(response.body).toHaveProperty('fileName', 'report_2024.pdf');
    });

    it('资产不存在应该返回 404', async () => {
      (AssetService.getAssetById as jest.Mock).mockResolvedValue(null);

      await request(app)
        .get('/api/v1/assets/non_existent_id/content')
        .expect(404);
    });

    it('内容不存在应该返回 404', async () => {
      const mockAsset = {
        assetId: 'asset_001',
        fileName: 'report_2024.pdf',
      };

      (AssetService.getAssetById as jest.Mock).mockResolvedValue(mockAsset);
      (AssetService.getAssetContent as jest.Mock).mockResolvedValue(null);

      await request(app)
        .get('/api/v1/assets/asset_001/content')
        .expect(404);
    });
  });

  describe('PATCH /api/v1/assets/:assetId', () => {
    it('应该能更新资产元数据', async () => {
      const mockUpdatedAsset = {
        assetId: 'asset_001',
        fileName: 'report_2024.pdf',
        year: 2024,
        region: 'beijing',
        department: '信息公开办',
      };

      (AssetService.updateAssetMetadata as jest.Mock).mockResolvedValue(mockUpdatedAsset);

      const response = await request(app)
        .patch('/api/v1/assets/asset_001')
        .send({
          year: 2024,
          region: 'beijing',
          department: '信息公开办',
        })
        .expect(200);

      expect(response.body).toHaveProperty('assetId', 'asset_001');
      expect(response.body).toHaveProperty('department', '信息公开办');
    });

    it('资产不存在应该返回 404', async () => {
      (AssetService.updateAssetMetadata as jest.Mock).mockResolvedValue(null);

      await request(app)
        .patch('/api/v1/assets/non_existent_id')
        .send({ year: 2024 })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/assets/:assetId', () => {
    it('应该能删除资产', async () => {
      (AssetService.deleteAsset as jest.Mock).mockResolvedValue(true);

      await request(app)
        .delete('/api/v1/assets/asset_001')
        .expect(200);

      expect(AssetService.deleteAsset).toHaveBeenCalledWith('asset_001');
    });

    it('资产不存在应该返回 404', async () => {
      (AssetService.deleteAsset as jest.Mock).mockResolvedValue(false);

      await request(app)
        .delete('/api/v1/assets/non_existent_id')
        .expect(404);
    });
  });
});
