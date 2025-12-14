/**
 * 城市-年份目录 API
 * 用于获取可用的城市和年份列表
 * 关键规则：只返回有 usable 资产的城市
 */

import { Router, Request, Response } from 'express';
import RegionService from '../services/RegionService';
import AssetQueryService from '../services/AssetQueryService';

const router = Router();

// 模拟数据：城市-年份映射（用于初始化）
const catalogData = {
  beijing: {
    name: '北京市',
    years: [2022, 2023, 2024],
  },
  shanghai: {
    name: '上海市',
    years: [2023, 2024],
  },
  guangzhou: {
    name: '广州市',
    years: [2023, 2024],
  },
  shenzhen: {
    name: '深圳市',
    years: [2024],
  },
  chengdu: {
    name: '成都市',
    years: [2023, 2024],
  },
  hangzhou: {
    name: '杭州市',
    years: [2023, 2024],
  },
};

/**
 * 获取城市列表
 * GET /api/v1/catalog/regions
 * 关键：只返回有至少 1 个 usable 资产的城市
 */
router.get('/regions', async (_req: Request, res: Response) => {
  try {
    const allRegions = await RegionService.getAllRegions();
    const regionsWithAssets = await AssetQueryService.getRegionsWithUsableAssets();

    // 只返回有 usable 资产的城市
    const regions = [];
    for (const region of allRegions) {
      if (regionsWithAssets.includes(region.regionId)) {
        const availableYears = await AssetQueryService.getAvailableYearsByRegion(
          region.regionId
        );
        regions.push({
          regionId: region.regionId,
          name: region.name,
          availableYears,
        });
      }
    }

    res.json({
      regions,
      total: regions.length,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 获取指定城市的年份列表（查询参数方式）
 * GET /api/v1/catalog/years?region=regionId
 * 关键：只返回 usable 资产对应的年份
 */
router.get('/years', async (req: Request, res: Response) => {
  try {
    const regionId = req.query.region as string;

    console.log('[Catalog API] 查询年份列表，regionId:', regionId);

    if (!regionId) {
      return res.status(400).json({ error: '缺少 region 参数' });
    }

    const region = await RegionService.getRegionById(regionId);
    if (!region) {
      console.log('[Catalog API] 城市不存在:', regionId);
      return res.status(404).json({ error: '城市不存在' });
    }

    const years = await AssetQueryService.getAvailableYearsByRegion(regionId);
    console.log('[Catalog API] 查询到的年份:', years);

    res.json({
      regionId,
      regionName: region.name,
      years: years.map(y => ({ year: y })),
      total: years.length,
    });
  } catch (error) {
    console.error('[Catalog API] 查询失败:', error);
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 获取指定城市的年份列表（路径参数方式）
 * GET /api/v1/catalog/regions/:regionId/years
 * 关键：只返回 usable 资产对应的年份
 */
router.get('/regions/:regionId/years', async (req: Request, res: Response) => {
  try {
    const regionId = req.params.regionId;

    const region = await RegionService.getRegionById(regionId);
    if (!region) {
      return res.status(404).json({ error: '城市不存在' });
    }

    const years = await AssetQueryService.getAvailableYearsByRegion(regionId);

    res.json({
      regionId,
      regionName: region.name,
      years,
      total: years.length,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 获取城市资源详情
 * GET /api/v1/catalog/regions/:regionId
 */
router.get('/regions/:regionId', async (req: Request, res: Response) => {
  try {
    const regionId = req.params.regionId;

    const region = await RegionService.getRegionById(regionId);
    if (!region) {
      return res.status(404).json({ error: '城市不存在' });
    }

    const years = await AssetQueryService.getAvailableYearsByRegion(regionId);

    res.json({
      regionId,
      name: region.name,
      availableYears: years,
      total: years.length,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

export default router;
