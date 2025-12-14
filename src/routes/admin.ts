/**
 * 后台管理 API 路由
 * 包括城市管理、年报汇总等功能
 */

import { Router, Request, Response } from 'express';
import RegionService from '../services/RegionService';
import AssetQueryService from '../services/AssetQueryService';
import { ReportAsset } from '../models/ReportAsset';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// ============ 城市管理 API ============

/**
 * 获取城市列表
 * GET /api/v1/admin/regions?page=1&pageSize=20
 */
router.get('/regions', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;

    const { regions, total } = await RegionService.getRegionsPaginated(page, pageSize);

    res.json({
      regions,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 获取单个城市
 * GET /api/v1/admin/regions/:regionId
 */
router.get('/regions/:regionId', async (req: Request, res: Response) => {
  try {
    const region = await RegionService.getRegionById(req.params.regionId);

    if (!region) {
      return res.status(404).json({ error: '城市不存在' });
    }

    res.json(region);
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 创建城市
 * POST /api/v1/admin/regions
 */
router.post('/regions', async (req: Request, res: Response) => {
  try {
    const { regionId, name, level, parentId, status, sortOrder } = req.body;

    if (!regionId || !name || !level) {
      return res.status(400).json({ error: '必须提供 regionId、name 和 level' });
    }

    const region = await RegionService.createRegion({
      regionId,
      name,
      level,
      parentId,
      status: status || 'active',
      sortOrder: sortOrder || 0,
    });

    res.status(201).json(region);
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 编辑城市
 * PUT /api/v1/admin/regions/:regionId
 */
router.put('/regions/:regionId', async (req: Request, res: Response) => {
  try {
    const { name, level, parentId, status, sortOrder } = req.body;

    const region = await RegionService.updateRegion(req.params.regionId, {
      name,
      level,
      parentId,
      status,
      sortOrder,
    });

    res.json(region);
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 删除城市
 * DELETE /api/v1/admin/regions/:regionId
 */
router.delete('/regions/:regionId', async (req: Request, res: Response) => {
  try {
    await RegionService.deleteRegion(req.params.regionId);
    res.json({ message: '城市已删除' });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

// ============ 年报汇总 API ============

/**
 * 获取年报列表
 * GET /api/v1/admin/reports?regionId=&year=&status=&q=&page=1&pageSize=20
 */
router.get('/reports', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;

    const filters = {
      regionId: req.query.regionId as string,
      year: req.query.year ? parseInt(req.query.year as string) : undefined,
      status: req.query.status as string,
      q: req.query.q as string,
    };

    console.log('[Admin API] 查询年报列表，过滤条件:', filters, '分页:', { page, pageSize });
    const { assets, total } = await AssetQueryService.getAllAssets(filters, page, pageSize);
    console.log('[Admin API] 查询结果:', { total, returned: assets.length });

    // 为每个资产添加地区名称
    const assetsWithRegionName = await Promise.all(
      assets.map(async (asset) => {
        let regionName = asset.region;
        if (asset.region) {
          const region = await RegionService.getRegionById(asset.region);
          if (region) {
            regionName = region.name;
          }
        }
        return {
          ...asset,
          regionName,
        };
      })
    );

    res.json({
      assets: assetsWithRegionName,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('[Admin API] 查询失败:', error);
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 获取年报统计
 * GET /api/v1/admin/reports/summary
 */
router.get('/reports/summary', async (req: Request, res: Response) => {
  try {
    const summary = await AssetQueryService.getSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 上传年报
 * POST /api/v1/admin/assets/upload
 * 支持 FormData 和 JSON 两种方式
 */
router.post('/assets/upload', async (req: Request, res: Response) => {
  try {
    console.log('[Admin API] 收到上传请求，body:', req.body);

    // 支持 FormData 和 JSON 两种方式
    let regionId = req.body.regionId;
    let year = req.body.year;
    let fileName = req.body.fileName;

    if (!regionId || !year) {
      console.log('[Admin API] 缺少必要参数 - regionId:', regionId, 'year:', year);
      return res.status(400).json({ error: '必须提供 regionId 和 year' });
    }

    // 如果有文件上传，使用文件名；否则使用提供的名称
    if (!fileName) {
      fileName = `report_${regionId}_${year}.pdf`;
    }

    console.log('[Admin API] 创建资产对象:', { regionId, year, fileName });

    // 使用 ReportAsset 模型的字段名（region 而不是 regionId）
    const asset = new ReportAsset({
      assetId: `asset_${uuidv4()}`,
      region: regionId,
      year: parseInt(year),
      fileName: fileName,
      fileSize: 0,
      fileHash: `hash_${uuidv4()}`,
      storagePath: `/uploads/${regionId}/${year}/${fileName}`,
      sourceType: 'upload',
      status: 'usable',
      parseVersion: '1.0',
      uploadedAt: new Date(),
      uploadedBy: (req.headers['x-user-id'] as string) || 'anonymous',
      updatedAt: new Date(),
      ownerId: (req.headers['x-user-id'] as string) || 'anonymous',
      visibility: 'org',
    });

    console.log('[Admin API] 添加资产到存储');
    // 添加到存储
    AssetQueryService.addAsset(asset);

    console.log('[Admin API] 上传成功，返回资产:', asset);
    res.status(201).json(asset);
  } catch (error) {
    console.error('[Admin API] 上传失败:', error);
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 重新归属资产
 * PUT /api/v1/admin/reports/:assetId/assign
 */
router.put('/reports/:assetId/assign', async (req: Request, res: Response) => {
  try {
    const { regionId, year, status } = req.body;

    // 这里应该从数据库查询并更新资产
    // 目前返回模拟数据
    const updatedAsset = {
      assetId: req.params.assetId,
      regionId: regionId || 'beijing',
      year: year || 2024,
      fileName: 'report.pdf',
      fileSize: 1024000,
      sourceType: 'upload',
      status: status || 'usable',
      parseVersion: '1.0',
      uploadedAt: new Date(),
      uploadedBy: 'admin',
      updatedAt: new Date(),
    };

    res.json(updatedAsset);
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 删除年报
 * DELETE /api/v1/admin/reports/:assetId
 */
router.delete('/reports/:assetId', async (req: Request, res: Response) => {
  try {
    const assetId = req.params.assetId;
    
    console.log('[Admin API] 删除年报:', assetId);
    
    // 从 AssetQueryService 中删除资产
    const deleted = AssetQueryService.deleteAsset(assetId);
    
    if (!deleted) {
      return res.status(404).json({ error: '年报不存在' });
    }
    
    console.log('[Admin API] 年报删除成功');
    res.json({ message: '年报已删除', assetId });
  } catch (error) {
    console.error('[Admin API] 删除失败:', error);
    res.status(500).json({ error: `${error}` });
  }
});

export default router;
