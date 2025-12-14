import { Router, Request, Response } from 'express';
import AssetService from '../services/AssetService';

const router = Router();

/**
 * 查询资料库
 * GET /api/v1/assets
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const year = req.query.year ? parseInt(req.query.year as string) : undefined;
    const region = req.query.region as string;
    const department = req.query.department as string;
    const status = req.query.status as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await AssetService.queryAssets({
      year,
      region,
      department,
      status: status as any,
      page,
      limit,
    });

    res.json({
      assets: result.assets.map((a) => ({
        assetId: a.assetId,
        fileName: a.fileName,
        year: a.year,
        region: a.region,
        department: a.department,
        status: a.status,
        uploadedAt: a.uploadedAt,
      })),
      total: result.total,
      page: result.page,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 获取资产详情
 * GET /api/v1/assets/:assetId
 */
router.get('/:assetId', async (req: Request, res: Response) => {
  try {
    const { assetId } = req.params;

    const asset = await AssetService.getAssetById(assetId);
    if (!asset) {
      return res.status(404).json({ error: '资产不存在' });
    }

    res.json({
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
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 获取资产的详细内容（已解析的结构化数据）
 * GET /api/v1/assets/:assetId/content
 */
router.get('/:assetId/content', async (req: Request, res: Response) => {
  try {
    const { assetId } = req.params;

    const asset = await AssetService.getAssetById(assetId);
    if (!asset) {
      return res.status(404).json({ error: '资产不存在' });
    }

    // 获取资产的结构化内容
    const content = await AssetService.getAssetContent(assetId);
    if (!content) {
      return res.status(404).json({ error: '资产内容不存在' });
    }

    res.json({
      assetId: asset.assetId,
      fileName: asset.fileName,
      year: asset.year,
      region: asset.region,
      content: content,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 获取资产的解析内容（结构化的章节和表格）
 * GET /api/v1/assets/:assetId/parse
 */
router.get('/:assetId/parse', async (req: Request, res: Response) => {
  try {
    const { assetId } = req.params;

    const asset = await AssetService.getAssetById(assetId);
    if (!asset) {
      return res.status(404).json({ error: '资产不存在' });
    }

    // 从存储中读取解析数据
    const parseData = await AssetService.getAssetParseData(assetId);
    
    if (!parseData) {
      return res.status(404).json({ 
        error: '解析数据不存在',
        assetId,
        message: '该资产还未被解析或解析数据已过期'
      });
    }
    
    res.json({
      assetId: asset.assetId,
      fileName: asset.fileName,
      year: asset.year,
      region: asset.region,
      parseVersion: asset.parseVersion,
      parsedContent: parseData,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 更新资产元数据
 * PATCH /api/v1/assets/:assetId
 */
router.patch('/:assetId', async (req: Request, res: Response) => {
  try {
    const { assetId } = req.params;
    const { year, region, department, reportType, tags } = req.body;

    const updated = await AssetService.updateAssetMetadata(assetId, {
      year,
      region,
      department,
      reportType,
      tags,
    });

    if (!updated) {
      return res.status(404).json({ error: '资产不存在' });
    }

    res.json({
      assetId: updated.assetId,
      year: updated.year,
      region: updated.region,
      department: updated.department,
      revision: updated.revision,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 批量上传资产
 * POST /api/v1/assets/batch-upload
 */
router.post('/batch-upload', async (req: Request, res: Response) => {
  try {
    // TODO: 处理multipart/form-data上传多个文件
    // 调用FileUploadService批量上传
    // 返回结果

    res.status(201).json({
      results: [
        {
          fileName: 'report_2024.pdf',
          status: 'success',
          assetId: 'asset_xxx',
          assetStatus: 'usable',
        },
      ],
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

export default router;
