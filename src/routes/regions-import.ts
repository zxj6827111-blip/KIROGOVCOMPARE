import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { readSheet } from 'read-excel-file/node';
import writeXlsxFile, { SheetData } from 'write-excel-file/node';
import { parse as parseCsv } from 'csv-parse/sync';
import pool from '../config/database-llm';
import { authMiddleware, AuthRequest, requirePermission } from '../middleware/auth';
import { isDepartmentRegion } from '../utils/regionUnitType';

const router = express.Router();
const REGION_IMPORT_MAX_ROWS = Number(process.env.REGION_IMPORT_MAX_ROWS || 10000);
const DEFAULT_REGION_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const configuredRegionImportMaxBytes = Number(process.env.REGION_IMPORT_MAX_BYTES);
const REGION_IMPORT_MAX_BYTES =
  Number.isFinite(configuredRegionImportMaxBytes) && configuredRegionImportMaxBytes > 0
    ? configuredRegionImportMaxBytes
    : DEFAULT_REGION_IMPORT_MAX_BYTES;

function sanitizeImportFileName(originalName: string): string {
  const baseName = path.basename(originalName || 'regions');
  const cleaned = baseName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'regions';
}

function normalizeRows(rows: unknown[][]): string[][] {
  return rows.slice(0, REGION_IMPORT_MAX_ROWS).map((row) =>
    row.map((value) => {
      if (value === null || value === undefined) return '';
      if (value instanceof Date) return value.toISOString();
      return String(value);
    })
  );
}

async function workbookToBuffer(data: string[][], sheetName: string): Promise<Buffer> {
  const workbook = await writeXlsxFile(data as SheetData, {
    sheet: sheetName,
    columns: [{ width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 24 }],
  });
  return workbook.toBuffer();
}

// Temp directory for uploads
const tempDir = path.join(process.cwd(), 'data', 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: tempDir,
    filename: (_req, file, cb) => {
      cb(null, `import_${Date.now()}_${sanitizeImportFileName(file.originalname)}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .xlsx 或 .csv 文件'));
    }
  },
  limits: {
    fileSize: REGION_IMPORT_MAX_BYTES,
    files: 1,
  },
});

const handleRegionImportUpload: express.RequestHandler = (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({
        error: error.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'invalid_upload',
        maxBytes: REGION_IMPORT_MAX_BYTES,
      });
    }
    if (error) {
      return res.status(400).json({ error: error.message || 'invalid_upload' });
    }
    next();
  });
};

/**
 * GET /api/regions/template
 * Download Excel template for region import
 */
router.get('/template', async (_req: Request, res: Response) => {
  try {

    // Sample data
    const data = [
      ['省份', '城市', '区县', '街道', '部门'],
      ['江苏省', '南京市', '玄武区', ''],
      ['江苏省', '南京市', '玄武区', '梅园新村街道', ''],
      ['江苏省', '南京市', '玄武区', '', '玄武区教育局'],
      ['江苏省', '苏州市', '姑苏区', ''],
      ['浙江省', '杭州市', '西湖区', ''],
      ['内蒙古自治区', '鄂尔多斯市', '伊金霍洛旗', '阿勒腾席热镇', ''],
      ['内蒙古自治区', '鄂尔多斯市', '伊金霍洛旗', '', '伊金霍洛旗财政局'],
    ];
    const buffer = await workbookToBuffer(data, '区域导入模板');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="region_import_template.xlsx"');
    res.send(buffer);
  } catch (error) {
    console.error('Error generating template:', error);
    res.status(500).json({ error: '生成模板失败' });
  }
});

/**
 * POST /api/regions/import
 * Import regions from Excel/CSV file
 */
router.post('/import', authMiddleware, requirePermission('manage_regions'), handleRegionImportUpload, async (req: AuthRequest, res: Response) => {
  const filePath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    const ext = path.extname(filePath!).toLowerCase();
    let rows: string[][];
    if (ext === '.csv') {
      // Manual encoding detection for text-based files
      const buffer = fs.readFileSync(filePath!);
      let content = '';

      // Heuristic: If UTF-8 decoding results in replacement characters, try GBK
      const utf8Str = buffer.toString('utf8');
      if (utf8Str.includes('\uFFFD')) {
        try {
          const decoder = new TextDecoder('gbk');
          content = decoder.decode(buffer);
        } catch (e) {
          content = utf8Str; // Fallback to UTF-8
        }
      } else {
        content = utf8Str;
      }

      rows = normalizeRows(parseCsv(content, {
        bom: true,
        relaxColumnCount: true,
        skipEmptyLines: false,
      }));
    } else {
      // Excel files (binary)
      const buffer = fs.readFileSync(filePath!);
      rows = normalizeRows(await readSheet(buffer));
    }

    if (rows.length < 2) {
      return res.status(400).json({ error: '文件为空或格式错误' });
    }

    // Skip header row
    const dataRows = rows.slice(1);
    const totalRows = dataRows.length;

    // Set headers for streaming
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendProgress = (progress: {
      percentage: number;
      current: number;
      total: number;
      message: string;
      created?: number;
      existed?: number;
      skipped?: number;
      row_errors?: string[];
      row_warnings?: string[];
    }) => {
      res.write(JSON.stringify(progress) + '\n');
    };

    // Track created regions
    let createdCount = 0;
    let skippedRowCount = 0;
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];
    const REGION_IMPORT_MAX_ROW_ERRORS = 50;
    const regionCache: Map<string, number> = new Map();

    const DIRECT_CITIES = ['上海市', '北京市', '天津市', '重庆市'];

    // Helper to generate cache key
    const genKey = (level: number, name: string, parentId: number | null) => `${level}_${name}_${parentId || 'null'}`;

    const pushRowError = (message: string) => {
      skippedRowCount += 1;
      if (rowErrors.length < REGION_IMPORT_MAX_ROW_ERRORS) {
        rowErrors.push(message);
      }
    };

    const pushRowWarning = (message: string) => {
      if (rowWarnings.length < REGION_IMPORT_MAX_ROW_ERRORS) {
        rowWarnings.push(message);
      }
    };

    // Load existing regions into cache
    const result = await pool.query('SELECT id, name, level, parent_id FROM regions ORDER BY level');
    const existingRegions = result.rows;

    for (const r of existingRegions) {
      const key = genKey(Number(r.level), r.name, r.parent_id ? Number(r.parent_id) : null);
      regionCache.set(key, Number(r.id));
    }

    let insertSeq = 0;

    /**
     * Get-or-create one node. `isDepartment` is only ever written as an explicit
     * `true` for the 部门 column; `null` keeps the node on name classification.
     */
    const ensureRegion = async (
      level: number,
      name: string,
      parentId: number | null,
      isDepartment: boolean | null,
      excelRow: number
    ): Promise<number | null> => {
      const key = genKey(level, name, parentId);
      const cached = regionCache.get(key);
      if (cached !== undefined) {
        return cached;
      }

      if (level > 4) {
        pushRowError(`${excelRow} 行：「${name}」超出 4 级层级（省/市/区县/街道），请改挂在区县列`);
        return null;
      }

      const code = `import_${Date.now()}_${(insertSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const inserted = await pool.query(
        'INSERT INTO regions (code, name, level, parent_id, is_department) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [code, name, level, parentId, isDepartment]
      );
      const id = Number(inserted.rows[0].id);
      regionCache.set(key, id);
      createdCount += 1;
      return id;
    };

    sendProgress({ percentage: 10, current: 0, total: totalRows, message: '分析数据结构...' });

    // One pass over the rows, creating each node on demand so the file does not
    // have to be sorted and so a broken parent surfaces as a row error instead
    // of silently dropping every row beneath it.
    const touchedExisting = new Set<string>();
    const HEADER_ROWS = 1;

    const trackExisting = (level: number, name: string, parentId: number | null) => {
      touchedExisting.add(genKey(level, name, parentId));
    };

    for (let i = 0; i < dataRows.length; i += 1) {
      const rawRow = dataRows[i] || [];
      const cells = [0, 1, 2, 3, 4].map((index) => String(rawRow[index] ?? '').trim());
      const excelRow = i + HEADER_ROWS + 1;

      if (cells.every((cell) => !cell)) continue;

      const [province, cityName, districtName, streetName, departmentName] = cells;
      if (!province) {
        pushRowError(`${excelRow} 行：缺少「省份」列，无法定位层级`);
        continue;
      }

      // 行政链：省 → 市 → 区县 →（非直辖市）街道/乡镇。直辖市只到三级，
      // 其部门请写在「部门」列，否则会与街道争同一列。
      const isDirectCity = DIRECT_CITIES.includes(province);
      const adminChain = [province, cityName, districtName, ...(isDirectCity ? [] : [streetName])];

      if (isDirectCity && streetName) {
        pushRowWarning(
          `${excelRow} 行：直辖市模型只到「街道」一级，第 4 列的「${streetName}」不会导入；部门请写在「部门」列`
        );
      }

      let deepestAdminIndex = 0;
      adminChain.forEach((name, index) => {
        if (name) deepestAdminIndex = index;
      });

      const gapIndex = adminChain.findIndex(
        (name, index) => index > 0 && index <= deepestAdminIndex && !name
      );
      if (gapIndex !== -1) {
        pushRowError(`${excelRow} 行：省/市/区县/街道需从左到右连续填写，第 ${gapIndex + 1} 列为空`);
        continue;
      }

      let parentId: number | null = null;
      let unresolved = false;
      for (let index = 0; index <= deepestAdminIndex; index += 1) {
        const level = index + 1;
        const name = adminChain[index];
        const cachedId = regionCache.get(genKey(level, name, parentId));
        if (cachedId !== undefined) {
          trackExisting(level, name, parentId);
          parentId = cachedId;
          continue;
        }
        const createdId = await ensureRegion(level, name, parentId, null, excelRow);
        if (createdId === null) {
          unresolved = true;
          break;
        }
        parentId = createdId;
      }
      if (unresolved) continue;

      if (departmentName) {
        // 部门挂在同行最深的行政节点下：区/县/旗（或市本级）之下，填到街道时挂街道。
        const departmentLevel = deepestAdminIndex + 2;
        const cachedId = regionCache.get(genKey(departmentLevel, departmentName, parentId));
        if (cachedId !== undefined) {
          trackExisting(departmentLevel, departmentName, parentId);
        } else {
          await ensureRegion(departmentLevel, departmentName, parentId, true, excelRow);
        }
      }

      if (i > 0 && i % 200 === 0) {
        sendProgress({
          percentage: Math.min(90, 10 + Math.round((i / totalRows) * 80)),
          current: i,
          total: totalRows,
          message: `已处理 ${i}/${totalRows} 行...`,
        });
      }
    }

    // Clean up temp file
    if (filePath) {
      fs.unlinkSync(filePath);
    }

    sendProgress({
      percentage: 100,
      current: totalRows,
      total: totalRows,
      message: `导入完成，新增 ${createdCount} 个区域，已存在 ${touchedExisting.size} 个`
        + (skippedRowCount > 0 ? `，跳过 ${skippedRowCount} 行` : ''),
      created: createdCount,
      existed: touchedExisting.size,
      skipped: skippedRowCount,
      row_errors: rowErrors,
      row_warnings: rowWarnings,
    });

    res.end();
  } catch (error: any) {

    // Clean up temp file
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    if (!res.headersSent) {
      res.status(500).json({ error: `导入失败: ${error.message}` });
    } else {
      res.write(JSON.stringify({ error: error.message }) + '\n');
      res.end();
    }
  }
});

/**
 * GET /api/regions/export
 * Export all regions to Excel
 *
 * Emitted in the same 5-column shape `/import` reads, so 导出 → 改 → 导入 round-trips:
 * administrative nodes fill 省份/城市/区县/街道 left to right, and a department is
 * written into 部门 with the 街道 cell left blank so it hangs off its 区县/旗,
 * not off a sibling 乡镇.
 */
router.get('/export', authMiddleware, requirePermission('manage_regions'), async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, name, level, parent_id, sort_order, is_department
      FROM regions
      ORDER BY level, sort_order, id
    `);

    const byId = new Map<number, any>();
    const childrenByParent = new Map<number | null, any[]>();
    const roots: any[] = [];

    for (const row of result.rows) {
      const node = {
        ...row,
        id: Number(row.id),
        parent_id: row.parent_id != null ? Number(row.parent_id) : null,
      };
      byId.set(node.id, node);
    }

    for (const node of byId.values()) {
      if (node.parent_id && byId.has(node.parent_id)) {
        const siblings = childrenByParent.get(node.parent_id) || [];
        siblings.push(node);
        childrenByParent.set(node.parent_id, siblings);
      } else {
        roots.push(node);
      }
    }

    const byTreeOrder = (a: any, b: any) => {
      const orderDiff = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
      return orderDiff !== 0 ? orderDiff : a.id - b.id;
    };
    roots.sort(byTreeOrder);
    for (const siblings of childrenByParent.values()) siblings.sort(byTreeOrder);

    const data: string[][] = [['省份', '城市', '区县', '街道', '部门']];

    const administrativePathOf = (node: any): string[] => {
      const names: string[] = [];
      const seen = new Set<number>();
      let cursor: any = node;
      while (cursor && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        if (!isDepartmentRegion(cursor)) names.unshift(cursor.name);
        cursor = cursor.parent_id ? byId.get(cursor.parent_id) : null;
      }
      return names;
    };

    const emit = (node: any) => {
      const path = administrativePathOf(node);
      if (path.length >= 1 && path.length <= 4) {
        const row = ['', '', '', '', ''];
        path.forEach((name, index) => { row[index] = name; });
        if (isDepartmentRegion(node)) {
          row[4] = node.name;
        }
        data.push(row);
      }

      for (const child of childrenByParent.get(node.id) || []) {
        emit(child);
      }
    };

    for (const root of roots) emit(root);

    const buffer = await workbookToBuffer(data, '区域数据');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="regions_export_${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: '导出失败' });
  }
});

export default router;
