/**
 * Mock 后端服务
 * 用于前端测试，提供模拟的 API 响应
 */

import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import catalogRouter from './routes/catalog';
import adminRouter from './routes/admin';
import AssetQueryService from './services/AssetQueryService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件服务
const publicPath = path.join(__dirname, '..', 'src', 'public');
app.use(express.static(publicPath));

// CORS 支持
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// 模拟数据存储
const mockTasks: any[] = [];
const mockAssets: any[] = [];

// 资产管理器（使用 AssetQueryService）
const assetManager = {
  addAsset: (asset: any) => {
    // 检查资产是否已存在（防止重复添加）
    const existing = AssetQueryService.getAssetById(asset.assetId);
    if (existing) {
      console.log('[Mock] 资产已存在，跳过重复添加:', asset.assetId);
      return;
    }
    // 添加到 AssetQueryService
    AssetQueryService.addAsset(asset);
    console.log('[Mock] 资产已添加:', asset.assetId);
  },
  getAsset: (assetId: string) => {
    // 从 AssetQueryService 查询
    return AssetQueryService.getAssetById(assetId);
  },
  getAllAssets: () => {
    // 从 AssetQueryService 获取所有资产
    return AssetQueryService.getAllAssetsSync();
  },
  deleteAsset: (assetId: string) => {
    return AssetQueryService.deleteAsset(assetId);
  },
};

// ============ 健康检查 ============
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'mock' });
});

// ============ 主页 ============
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ 后台管理页面 ============
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ============ 目录 API ============
app.use('/api/v1/catalog', catalogRouter);

// ============ 后台管理 API ============
app.use('/api/v1/admin', adminRouter);

// ============ 任务相关 API ============

/**
 * 获取任务列表
 */
app.get('/api/v1/tasks', (req: Request, res: Response) => {
  const status = req.query.status as string;
  let tasks = mockTasks;
  
  if (status) {
    tasks = tasks.filter(t => t.status === status);
  }
  
  res.json({
    tasks,
    total: tasks.length,
  });
});

/**
 * 获取单个任务
 */
app.get('/api/v1/tasks/:taskId', (req: Request, res: Response) => {
  const task = mockTasks.find(t => t.taskId === req.params.taskId);
  
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }
  
  res.json(task);
});

/**
 * 创建比对任务 - 城市-年份方式（新）
 */
app.post('/api/v1/tasks/compare/region-year', (req: Request, res: Response) => {
  try {
    const { region, yearA, yearB } = req.body;
    const userId = req.headers['x-user-id'] as string || 'anonymous';

    if (!region || !yearA || !yearB) {
      return res.status(400).json({ error: '必须提供城市、年份A和年份B' });
    }

    const taskId = `task_${uuidv4()}`;
    const task = {
      taskId,
      region,
      yearA: parseInt(yearA),
      yearB: parseInt(yearB),
      assetId_A: `asset_${region}_${yearA}`,
      assetId_B: `asset_${region}_${yearB}`,
      status: 'queued',
      stage: 'pending',
      progress: 0,
      message: `任务已入队，等待处理 (${region} ${yearA}年 vs ${yearB}年)`,
      warnings: [],
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockTasks.push(task);

    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 创建比对任务 - URL 方式（保留兼容）
 */
app.post('/api/v1/tasks/compare/url', (req: Request, res: Response) => {
  try {
    const { urlA, urlB } = req.body;
    const userId = req.headers['x-user-id'] as string || 'anonymous';

    if (!urlA || !urlB) {
      return res.status(400).json({ error: '必须提供两个 URL' });
    }

    const taskId = `task_${uuidv4()}`;
    const task = {
      taskId,
      assetId_A: `asset_${uuidv4()}`,
      assetId_B: `asset_${uuidv4()}`,
      status: 'queued',
      stage: 'pending',
      progress: 0,
      message: '任务已入队，等待处理',
      warnings: [],
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockTasks.push(task);

    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 创建比对任务 - 上传方式
 */
app.post('/api/v1/tasks/compare/upload', (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string || 'anonymous';

    const taskId = `task_${uuidv4()}`;
    const task = {
      taskId,
      assetId_A: `asset_${uuidv4()}`,
      assetId_B: `asset_${uuidv4()}`,
      status: 'queued',
      stage: 'pending',
      progress: 0,
      message: '任务已入队，等待处理',
      warnings: [],
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockTasks.push(task);

    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 获取任务的视图模型（全文对照）
 */
app.get('/api/v1/tasks/:taskId/view-model', (req: Request, res: Response) => {
  const task = mockTasks.find(t => t.taskId === req.params.taskId);

  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }

  // 模拟视图模型数据
  const viewModel = {
    taskId: req.params.taskId,
    sections: [
      {
        sectionId: 'section_1',
        sectionTitle: '一、概述',
        level: 1,
        blocks: [
          {
            type: 'paragraph',
            status: 'modified',
            beforeText: '本年度报告根据《条例》编制。',
            afterText: '本年度报告根据《条例》和相关规定编制。',
            inlineDiff: [
              { type: 'equal', text: '本年度报告根据《条例》' },
              { type: 'insert', text: '和相关规定' },
              { type: 'equal', text: '编制。' },
            ],
          },
        ],
      },
      {
        sectionId: 'section_2',
        sectionTitle: '二、主动公开政府信息情况',
        level: 1,
        blocks: [
          {
            type: 'table',
            status: 'modified',
            tableData: {
              schemaTableId: 'table_chapter2_section1',
              tableA: null,
              tableB: null,
              cellDiffs: [
                {
                  rowIndex: 0,
                  colIndex: 0,
                  rowLabel: '主动公开条数',
                  colName: '数值',
                  beforeValue: '1000',
                  afterValue: '1200',
                  status: 'modified',
                },
              ],
              metricsDiffs: [
                {
                  rowLabel: '主动公开条数',
                  beforeValue: 1000,
                  afterValue: 1200,
                  delta: 200,
                  deltaPercent: 20,
                },
              ],
            },
          },
        ],
      },
      {
        sectionId: 'section_3',
        sectionTitle: '三、收到和处理政府信息公开申请情况',
        level: 1,
        blocks: [
          {
            type: 'table',
            status: 'modified',
            tableData: {
              schemaTableId: 'table_chapter3_foia_requests',
              tableA: null,
              tableB: null,
              cellDiffs: [
                {
                  rowIndex: 0,
                  colIndex: 1,
                  rowLabel: '收到申请数',
                  colName: '自然人',
                  beforeValue: '100',
                  afterValue: '150',
                  status: 'modified',
                },
                {
                  rowIndex: 1,
                  colIndex: 1,
                  rowLabel: '其中：1.当面申请',
                  colName: '自然人',
                  beforeValue: '20',
                  afterValue: '30',
                  status: 'modified',
                },
              ],
              metricsDiffs: [
                {
                  rowLabel: '收到申请数',
                  beforeValue: 100,
                  afterValue: 150,
                  delta: 50,
                  deltaPercent: 50,
                },
                {
                  rowLabel: '其中：1.当面申请',
                  beforeValue: 20,
                  afterValue: 30,
                  delta: 10,
                  deltaPercent: 50,
                },
              ],
            },
          },
        ],
      },
    ],
  };

  res.json(viewModel);
});

/**
 * 获取任务的差异结果
 */
app.get('/api/v1/tasks/:taskId/diff', (req: Request, res: Response) => {
  const task = mockTasks.find(t => t.taskId === req.params.taskId);
  
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }

  // 模拟差异结果
  const diffResult = {
    taskId: req.params.taskId,
    sections: [
      {
        sectionId: 'section_1',
        sectionTitle: '一、概述',
        level: 1,
        paragraphs: [
          {
            id: 'para_1',
            type: 'modified',
            before: '本年度报告根据《条例》编制。',
            after: '本年度报告根据《条例》和相关规定编制。',
          },
        ],
        tables: [],
      },
      {
        sectionId: 'section_2',
        sectionTitle: '二、主动公开政府信息情况',
        level: 1,
        paragraphs: [],
        tables: [
          {
            tableId: 'table_chapter2_section1',
            type: 'modified',
            alignmentQuality: 'perfect',
            cellChanges: [
              {
                rowIndex: 0,
                colIndex: 0,
                rowLabel: '主动公开条数',
                colName: '数值',
                type: 'modified',
                before: '1000',
                after: '1200',
              },
            ],
          },
        ],
      },
      {
        sectionId: 'section_3',
        sectionTitle: '三、收到和处理政府信息公开申请情况',
        level: 1,
        paragraphs: [],
        tables: [
          {
            tableId: 'table_chapter3_foia_requests',
            type: 'modified',
            alignmentQuality: 'perfect',
            cellChanges: [
              {
                rowIndex: 0,
                colIndex: 1,
                rowLabel: '收到申请数',
                colName: '自然人',
                type: 'modified',
                before: '100',
                after: '150',
              },
              {
                rowIndex: 1,
                colIndex: 1,
                rowLabel: '其中：1.当面申请',
                colName: '自然人',
                type: 'modified',
                before: '20',
                after: '30',
              },
            ],
          },
        ],
      },
      {
        sectionId: 'section_4',
        sectionTitle: '四、政府信息公开行政复议、行政诉讼情况',
        level: 1,
        paragraphs: [],
        tables: [
          {
            tableId: 'table_chapter4_administrative_review',
            type: 'modified',
            alignmentQuality: 'perfect',
            cellChanges: [
              {
                rowIndex: 0,
                colIndex: 0,
                rowLabel: '数据',
                colName: '行政复议申请数',
                type: 'modified',
                before: '5',
                after: '8',
              },
            ],
          },
        ],
      },
    ],
  };

  res.json(diffResult);
});

/**
 * 获取任务摘要
 */
app.get('/api/v1/tasks/:taskId/summary', (req: Request, res: Response) => {
  const task = mockTasks.find(t => t.taskId === req.params.taskId);
  
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }

  // 模拟摘要
  const summary = {
    taskId: req.params.taskId,
    topChangedSections: [
      {
        sectionName: '三、收到和处理政府信息公开申请情况',
        totalChangeCount: 15,
        changeBreakdown: {
          added: 3,
          deleted: 2,
          modified: 10,
        },
      },
      {
        sectionName: '二、主动公开政府信息情况',
        totalChangeCount: 8,
        changeBreakdown: {
          added: 1,
          deleted: 1,
          modified: 6,
        },
      },
    ],
    statistics: {
      addedParagraphs: 2,
      deletedParagraphs: 1,
      modifiedParagraphs: 5,
      addedTables: 0,
      deletedTables: 0,
      modifiedTables: 3,
    },
    keyNumberChanges: [
      {
        location: '三、收到申请数 / 自然人',
        oldValue: '100',
        newValue: '150',
        changeType: 'modified',
      },
      {
        location: '二、主动公开条数',
        oldValue: '1000',
        newValue: '1200',
        changeType: 'modified',
      },
    ],
    overallAssessment: '年度报告有较大变化，主要体现在申请处理数量增加和公开条数增加。',
  };

  res.json(summary);
});

// ============ 资产相关 API ============

/**
 * 获取资产列表
 */
app.get('/api/v1/assets', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    
    const filters = {
      regionId: req.query.regionId as string,
      year: req.query.year ? parseInt(req.query.year as string) : undefined,
      status: req.query.status as string,
      q: req.query.q as string,
    };

    const { assets, total } = await AssetQueryService.getAllAssets(filters, page, pageSize);
    
    res.json({
      assets,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('[Mock] 获取资产列表失败:', error);
    res.status(500).json({ error: `获取资产列表失败: ${error}` });
  }
});

/**
 * 获取资产详情
 */
app.get('/api/v1/assets/:assetId', (req: Request, res: Response) => {
  const asset = assetManager.getAsset(req.params.assetId);
  
  if (!asset) {
    return res.status(404).json({ error: '资产不存在' });
  }
  
  res.json(asset);
});

/**
 * 解析 PDF 并获取内容
 */
app.get('/api/v1/assets/:assetId/parse', async (req: Request, res: Response) => {
  try {
    // 先从全局存储查找资产
    let asset = assetManager.getAsset(req.params.assetId);
    if (!asset) {
      asset = mockAssets.find(a => a.assetId === req.params.assetId);
    }

    if (!asset) {
      return res.status(404).json({ error: '资产不存在' });
    }

    // 如果是黄浦区的年报，返回真实的 PDF 解析结果
    if (asset.region === 'huangpu_city') {
      const PdfParseService = require('./services/PdfParseService').default;
      const path = require('path');
      const fs = require('fs');

      const pdfPath = path.join(__dirname, `../fixtures/sample_pdfs_v1/上海市黄浦区人民政府${asset.year}年政府信息公开工作年度报告${asset.year === 2022 ? '（超链版）' : ''}.pdf`);

      if (fs.existsSync(pdfPath)) {
        const parseResult = await PdfParseService.parsePDF(pdfPath, asset.assetId);
        if (parseResult.success && parseResult.document) {
          const doc = parseResult.document;
          const sections = doc.sections.map((section: any) => ({
            title: section.title,
            content: section.content.map((p: any) => p.text).join('\n\n'),
            tables: section.tables.map((table: any) => ({
              title: table.title,
              rows: table.rows.map((row: any) => ({
                cells: row.cells.map((cell: any) => cell.content),
              })),
              columns: table.columns,
            })),
          }));

          return res.json({
            assetId: asset.assetId,
            fileName: asset.fileName,
            year: asset.year,
            region: asset.region,
            parsedContent: { sections },
          });
        }
      }
    }

    // 如果无法解析，返回默认内容
    res.json({
      assetId: asset.assetId,
      fileName: asset.fileName,
      year: asset.year,
      region: asset.region,
      parsedContent: { sections: [] },
    });
  } catch (error) {
    console.error('[Mock] PDF 解析错误:', error);
    res.status(500).json({ error: `解析失败: ${error}` });
  }
});

/**
 * 获取资产内容
 */
app.get('/api/v1/assets/:assetId/content', async (req: Request, res: Response) => {
  try {
    const asset = assetManager.getAsset(req.params.assetId);
    
    if (!asset) {
      console.warn('[Mock] 资产不存在:', req.params.assetId);
      return res.status(404).json({ error: '资产不存在' });
    }
    
    console.log('[Mock] 获取资产内容:', asset.assetId);
    
    // 尝试从真实的 PDF 文件解析内容
    let parsedContent = { sections: [] };
    let parseWarnings: any[] = [];
    
    if (asset.storagePath) {
      try {
        const PdfParseService = require('./services/PdfParseService').default;
        const pathModule = require('path');
        const fs = require('fs');
        
        // 构建完整的文件路径
        let filePath = asset.storagePath;
        if (!pathModule.isAbsolute(filePath)) {
          filePath = pathModule.join(process.cwd(), filePath);
        }
        
        console.log('[Mock] 尝试解析 PDF 文件:', filePath);
        
        if (fs.existsSync(filePath)) {
          const parseResult = await PdfParseService.parsePDF(filePath, asset.assetId);
          
          if (parseResult.success && parseResult.document) {
            const doc = parseResult.document;
            parseWarnings = parseResult.warnings || [];
            
            // 转换为前端需要的格式
            parsedContent = {
              sections: doc.sections.map((section: any) => ({
                id: section.id,
                title: section.title,
                level: section.level,
                content: section.content.map((p: any) => p.text).join('\n\n'),
                tables: section.tables.map((table: any) => ({
                  id: table.id,
                  title: table.title,
                  rows: table.rows.map((row: any) => ({
                    cells: row.cells.map((cell: any) => cell.content),
                  })),
                  columns: table.columns,
                })),
              })),
            };
            
            console.log('[Mock] PDF 解析成功，共', doc.sections.length, '个章节');
            if (parseWarnings.length > 0) {
              console.log('[Mock] 解析警告:', parseWarnings.length, '条');
            }
          } else {
            console.warn('[Mock] PDF 解析失败:', parseResult.error);
            parseWarnings = parseResult.warnings || [];
          }
        } else {
          console.warn('[Mock] PDF 文件不存在:', filePath);
        }
      } catch (error) {
        console.error('[Mock] PDF 解析异常:', error);
      }
    }
    
    // 返回资产的详细信息和解析内容
    res.json({
      assetId: asset.assetId,
      fileName: asset.fileName || '政府信息公开年度报告.pdf',
      fileSize: asset.fileSize || 0,
      year: asset.year || new Date().getFullYear(),
      region: asset.region || '-',
      status: asset.status || 'usable',
      uploadedBy: asset.uploadedBy || 'anonymous',
      uploadedAt: asset.uploadedAt || new Date(),
      updatedAt: asset.updatedAt || new Date(),
      reportType: asset.reportType || '政府信息公开年度报告',
      parseVersion: asset.parseVersion || '2.0',
      fileHash: asset.fileHash || `hash_${asset.assetId}`,
      parsedContent,
      parseWarnings,
    });
  } catch (error) {
    console.error('[Mock] 获取资产内容异常:', error);
    res.status(500).json({ error: `获取资产内容失败: ${error}` });
  }
});

/**
 * 上传资产
 */
app.post('/api/v1/assets/upload', (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string || 'anonymous';
    const fs = require('fs');
    const pathModule = require('path');
    
    // 尝试从 fixtures 目录查找真实的 PDF 文件
    let storagePath = `/uploads/${uuidv4()}.pdf`;
    const fileName = req.body.fileName || 'report.pdf';
    
    // 如果是已知的示例 PDF，使用真实路径
    const fixturesPath = pathModule.join(__dirname, '../fixtures/sample_pdfs_v1', fileName);
    if (fs.existsSync(fixturesPath)) {
      storagePath = fixturesPath;
      console.log('[Mock] 使用真实 PDF 文件:', storagePath);
    }
    
    const asset = {
      assetId: `asset_${uuidv4()}`,
      fileName: fileName,
      fileSize: req.body.fileSize || 1024000,
      year: req.body.year || new Date().getFullYear(),
      region: req.body.region,
      status: 'usable',
      uploadedBy: userId,
      uploadedAt: new Date(),
      updatedAt: new Date(),
      ownerId: userId,
      visibility: 'private',
      sourceType: 'upload',
      fileHash: `hash_${uuidv4()}`,
      storagePath: storagePath,
    };

    assetManager.addAsset(asset);

    res.status(201).json(asset);
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

// ============ 建议相关 API ============

/**
 * 获取 AI 建议
 */
app.get('/api/v1/tasks/:taskId/suggestions', (req: Request, res: Response) => {
  const task = mockTasks.find(t => t.taskId === req.params.taskId);
  
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }

  const suggestions = {
    suggestionId: `suggestion_${uuidv4()}`,
    compareTaskId: req.params.taskId,
    status: 'completed',
    interpretation: '年度报告显示政府信息公开工作稳步推进，申请处理数量增加，公开条数增加。',
    suspiciousPoints: [
      {
        location: '三、申请处理时间',
        description: '平均处理时间有所增加，可能需要优化流程',
        riskLevel: 'medium',
        recommendation: '建议分析处理时间增加的原因',
      },
    ],
    improvementSuggestions: [
      '加强信息公开的及时性',
      '优化申请处理流程',
      '提高公开信息的质量',
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: new Date(),
  };

  res.json(suggestions);
});

// ============ 错误处理 ============
app.use((err: any, _req: express.Request, res: Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ============ 启动服务器 ============
async function start(): Promise<void> {
  try {
    console.log('🚀 启动 Mock 后端服务...');
    console.log('');

    app.listen(PORT, () => {
      console.log(`✅ 服务器运行在 http://localhost:${PORT}`);
      console.log(`📍 健康检查: http://localhost:${PORT}/health`);
      console.log('');
      console.log('📚 可用的 API 端点:');
      console.log('');
      console.log('  任务相关:');
      console.log(`    - GET  /api/v1/tasks - 获取任务列表`);
      console.log(`    - GET  /api/v1/tasks/:taskId - 获取单个任务`);
      console.log(`    - POST /api/v1/tasks/compare/url - 创建比对任务（URL方式）`);
      console.log(`    - POST /api/v1/tasks/compare/upload - 创建比对任务（上传方式）`);
      console.log(`    - GET  /api/v1/tasks/:taskId/diff - 获取差异结果`);
      console.log(`    - GET  /api/v1/tasks/:taskId/summary - 获取摘要`);
      console.log('');
      console.log('  资产相关:');
      console.log(`    - GET  /api/v1/assets - 获取资产列表`);
      console.log(`    - POST /api/v1/assets/upload - 上传资产`);
      console.log('');
      console.log('  建议相关:');
      console.log(`    - GET  /api/v1/tasks/:taskId/suggestions - 获取 AI 建议`);
      console.log('');
      console.log('按 Ctrl+C 停止服务器');
    });
  } catch (error) {
    console.error('❌ 启动失败:', error);
    process.exit(1);
  }
}

start();
