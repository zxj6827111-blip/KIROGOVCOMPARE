import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { querySqlite, sqlValue, ensureSqliteMigrations } from '../config/sqlite';
import { authMiddleware, AuthRequest, requirePermission } from '../middleware/auth';

const router = express.Router();

// Temp directory for uploads
const tempDir = path.join(process.cwd(), 'data', 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: tempDir,
    filename: (_req, file, cb) => {
      cb(null, `import_${Date.now()}_${file.originalname}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .xlsx, .xls, .csv 格式'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

/**
 * GET /api/regions/template
 * Download Excel template for region import
 */
router.get('/template', (_req: Request, res: Response) => {
  try {
    // Create template workbook
    const wb = XLSX.utils.book_new();

    // Sample data
    const data = [
      ['省份', '城市', '区县', '街道'],
      ['江苏省', '南京市', '玄武区', ''],
      ['江苏省', '南京市', '秦淮区', ''],
      ['江苏省', '南京市', '鼓楼区', ''],
      ['江苏省', '苏州市', '姑苏区', ''],
      ['江苏省', '苏州市', '工业园区', ''],
      ['浙江省', '杭州市', '西湖区', ''],
      ['浙江省', '杭州市', '上城区', ''],
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    ws['!cols'] = [
      { wch: 15 }, // 省份
      { wch: 15 }, // 城市
      { wch: 15 }, // 区县
      { wch: 15 }, // 街道
    ];

    XLSX.utils.book_append_sheet(wb, ws, '城市导入模板');

    // Generate buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

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
router.post('/import', authMiddleware, requirePermission('manage_cities'), upload.single('file'), async (req: AuthRequest, res: Response) => {
  const filePath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    ensureSqliteMigrations();

    let wb: XLSX.WorkBook;

    const ext = path.extname(filePath!).toLowerCase();
    if (ext === '.csv' || ext === '.txt') {
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

      wb = XLSX.read(content, { type: 'string' });
    } else {
      // Excel files (binary)
      wb = XLSX.readFile(filePath!);
    }

    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];

    // Convert to JSON
    const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

    if (rows.length < 2) {
      return res.status(400).json({ error: '文件为空或格式错误' });
    }

    // Skip header row
    const dataRows = rows.slice(1);
    const totalRows = dataRows.length;

    // Set headers for streaming
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendProgress = (progress: { percentage: number; current: number; total: number; message: string }) => {
      res.write(JSON.stringify(progress) + '\n');
    };

    // Track created regions
    const created: { level: number; name: string }[] = [];
    const errors: string[] = [];
    const regionCache: Map<string, number> = new Map();

    // Load existing regions into cache
    const existingRegions = querySqlite('SELECT id, name, level, parent_id FROM regions ORDER BY level');
    for (const r of existingRegions) {
      const key = `${r.level}_${r.name}_${r.parent_id || 'null'}`;
      regionCache.set(key, r.id);
    }

    // Prepare data structures for level-based processing
    // We need to process the file and determine unique regions for each level
    // format: { name, parentName, parentLevel } - but parentID is needed.
    // Actually, we can just process the rows and build a pending list for current level.

    const DIRECT_CITIES = ['上海市', '北京市', '天津市', '重庆市'];

    // Helper to generate cache key
    const genKey = (level: number, name: string, parentId: number | null) => `${level}_${name}_${parentId || 'null'}`;

    // Helper to batch insert
    const batchInsert = (items: { name: string, level: number, parentId: number | null }[]) => {
      if (items.length === 0) return;

      const values = items.map(item => {
        const code = `import_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        return `(${sqlValue(code)}, ${sqlValue(item.name)}, ${sqlValue(item.level)}, ${item.parentId ? sqlValue(item.parentId) : 'NULL'})`;
      });

      // SQLite limit is usually 999 vars, but we are concatenating strings, so limit is SQL length.
      // Split into safe chunks (e.g. 500 rows)
      const CHUNK = 200;
      for (let i = 0; i < values.length; i += CHUNK) {
        const chunkValues = values.slice(i, i + CHUNK);
        const sql = `INSERT INTO regions (code, name, level, parent_id) VALUES ${chunkValues.join(',')}`;
        querySqlite(sql);
      }
    };

    // Helper to refresh cache for a specific level
    const refreshCache = (level: number) => {
      const rows = querySqlite(`SELECT id, name, parent_id FROM regions WHERE level = ${level}`);
      for (const r of rows) {
        const key = genKey(level, r.name, r.parent_id);
        regionCache.set(key, r.id);
      }
    };

    sendProgress({ percentage: 10, current: 0, total: totalRows, message: '分析数据结构...' });

    // We process level by level.
    // L1
    const pendingL1 = new Map<string, { name: string }>();

    for (const row of dataRows) {
      if (!row || row.length === 0) continue;
      const province = (row[0] || '').toString().trim();
      if (!province) continue;

      const key = genKey(1, province, null);
      if (!regionCache.has(key)) {
        pendingL1.set(key, { name: province });
      }
    }

    if (pendingL1.size > 0) {
      sendProgress({ percentage: 20, current: 0, total: totalRows, message: '正在创建一级行政区...' });
      batchInsert(Array.from(pendingL1.values()).map(v => ({ name: v.name, level: 1, parentId: null })));
      refreshCache(1);
    }

    // L2
    const pendingL2 = new Map<string, { name: string, parentId: number }>();

    for (const row of dataRows) {
      const cells = row.map(c => (c || '').toString().trim());
      const province = cells[0];
      if (!province) continue;

      const l1Id = regionCache.get(genKey(1, province, null));
      if (!l1Id) continue;

      let l2Name = '';
      if (DIRECT_CITIES.includes(province)) {
        l2Name = cells[1]; // District as L2
      } else {
        l2Name = cells[1]; // City as L2
      }

      if (l2Name) {
        const key = genKey(2, l2Name, l1Id);
        if (!regionCache.has(key)) {
          pendingL2.set(key, { name: l2Name, parentId: l1Id });
        }
      }
    }

    if (pendingL2.size > 0) {
      sendProgress({ percentage: 40, current: 0, total: totalRows, message: '正在创建二级行政区...' });
      batchInsert(Array.from(pendingL2.values()).map(v => ({ name: v.name, level: 2, parentId: v.parentId })));
      refreshCache(2);
    }

    // L3
    const pendingL3 = new Map<string, { name: string, parentId: number }>();

    for (const row of dataRows) {
      const cells = row.map(c => (c || '').toString().trim());
      const province = cells[0];
      if (!province) continue;

      const l1Id = regionCache.get(genKey(1, province, null));
      if (!l1Id) continue;

      if (DIRECT_CITIES.includes(province)) {
        // Direct City L3 = Street (Col C)
        // Parent is District (L2) (Col B)
        const districtName = cells[1];
        const streetName = cells[2];

        if (districtName && streetName) {
          const l2Id = regionCache.get(genKey(2, districtName, l1Id));
          if (l2Id) {
            const key = genKey(3, streetName, l2Id);
            if (!regionCache.has(key)) {
              pendingL3.set(key, { name: streetName, parentId: l2Id });
            }
          }
        }
      } else {
        // Normal L3 = District (Col C)
        // Parent is City (L2) (Col B)
        const cityName = cells[1];
        const districtName = cells[2];

        if (cityName && districtName) {
          const l2Id = regionCache.get(genKey(2, cityName, l1Id));
          if (l2Id) {
            const key = genKey(3, districtName, l2Id);
            if (!regionCache.has(key)) {
              pendingL3.set(key, { name: districtName, parentId: l2Id });
            }
          }
        }
      }
    }

    if (pendingL3.size > 0) {
      sendProgress({ percentage: 60, current: 0, total: totalRows, message: '正在创建三级行政区...' });
      batchInsert(Array.from(pendingL3.values()).map(v => ({ name: v.name, level: 3, parentId: v.parentId })));
      refreshCache(3);
    }

    // L4
    const pendingL4 = new Map<string, { name: string, parentId: number }>();

    for (const row of dataRows) {
      const cells = row.map(c => (c || '').toString().trim());
      const province = cells[0];
      if (!province) continue;

      if (DIRECT_CITIES.includes(province)) {
        // No L4 for direct cities in this 3-level model
        continue;
      } else {
        // Normal L4 = Street (Col D)
        // Parent is District (L3) (Col C)
        const cityName = cells[1];
        const districtName = cells[2];
        const streetName = cells[3];

        if (cityName && districtName && streetName) {
          const l1Id = regionCache.get(genKey(1, province, null));
          if (!l1Id) continue;
          const l2Id = regionCache.get(genKey(2, cityName, l1Id));
          if (!l2Id) continue;
          const l3Id = regionCache.get(genKey(3, districtName, l2Id));

          if (l3Id) {
            const key = genKey(4, streetName, l3Id);
            if (!regionCache.has(key)) {
              pendingL4.set(key, { name: streetName, parentId: l3Id });
            }
          }
        }
      }
    }

    if (pendingL4.size > 0) {
      sendProgress({ percentage: 80, current: 0, total: totalRows, message: '正在创建四级行政区...' });
      batchInsert(Array.from(pendingL4.values()).map(v => ({ name: v.name, level: 4, parentId: v.parentId })));
      // No need to refresh cache for L4 as it's the last level
    }

    // Verify counts (approximate)
    let createdCount = pendingL1.size + pendingL2.size + pendingL3.size + pendingL4.size;

    // Clean up temp file
    if (filePath) {
      fs.unlinkSync(filePath);
    }

    sendProgress({
      percentage: 100,
      current: totalRows,
      total: totalRows,
      message: `导入完成，新增 ${createdCount} 个区域`
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
 */
router.get('/export', authMiddleware, requirePermission('manage_cities'), (_req: AuthRequest, res: Response) => {
  try {
    ensureSqliteMigrations();

    const regions = querySqlite(`
      SELECT r.id, r.name, r.level, r.parent_id, p.name as parent_name
      FROM regions r
      LEFT JOIN regions p ON r.parent_id = p.id
      ORDER BY r.level, r.id
    `);

    // Build hierarchical data
    const data: string[][] = [['省份', '城市', '区县', '街道']];

    // Group by hierarchy
    const provinceMap = new Map<number, { name: string; cities: Map<number, { name: string; districts: Map<number, { name: string; streets: string[] }> }> }>();

    for (const r of regions) {
      if (r.level === 1) {
        provinceMap.set(r.id, { name: r.name, cities: new Map() });
      }
    }

    for (const r of regions) {
      if (r.level === 2 && r.parent_id) {
        const province = provinceMap.get(r.parent_id);
        if (province) {
          province.cities.set(r.id, { name: r.name, districts: new Map() });
        }
      }
    }

    for (const r of regions) {
      if (r.level === 3 && r.parent_id) {
        for (const province of provinceMap.values()) {
          const city = province.cities.get(r.parent_id);
          if (city) {
            city.districts.set(r.id, { name: r.name, streets: [] });
          }
        }
      }
    }

    for (const r of regions) {
      if (r.level === 4 && r.parent_id) {
        for (const province of provinceMap.values()) {
          for (const city of province.cities.values()) {
            const district = city.districts.get(r.parent_id);
            if (district) {
              district.streets.push(r.name);
            }
          }
        }
      }
    }

    // Flatten to rows
    for (const [, province] of provinceMap) {
      if (province.cities.size === 0) {
        data.push([province.name, '', '', '']);
      } else {
        for (const [, city] of province.cities) {
          if (city.districts.size === 0) {
            data.push([province.name, city.name, '', '']);
          } else {
            for (const [, district] of city.districts) {
              if (district.streets.length === 0) {
                data.push([province.name, city.name, district.name, '']);
              } else {
                for (const street of district.streets) {
                  data.push([province.name, city.name, district.name, street]);
                }
              }
            }
          }
        }
      }
    }

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws, '城市列表');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="regions_export_${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: '导出失败' });
  }
});

export default router;
