import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { querySqlite, sqlValue, ensureSqliteMigrations } from '../config/sqlite';
import { authMiddleware, AuthRequest } from '../middleware/auth';

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
router.post('/import', authMiddleware, upload.single('file'), async (req: AuthRequest, res: Response) => {
  const filePath = req.file?.path;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }
    
    ensureSqliteMigrations();
    
    // Read workbook
    const wb = XLSX.readFile(filePath!);
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    
    // Convert to JSON
    const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
    
    if (rows.length < 2) {
      return res.status(400).json({ error: '文件为空或格式错误' });
    }
    
    // Skip header row
    const dataRows = rows.slice(1);
    
    // Track created regions
    const created: { level: number; name: string; parentName?: string }[] = [];
    const errors: string[] = [];
    const regionCache: Map<string, number> = new Map();
    
    // Load existing regions into cache
    const existingRegions = querySqlite('SELECT id, name, level, parent_id FROM regions ORDER BY level');
    for (const r of existingRegions) {
      const key = `${r.level}_${r.name}_${r.parent_id || 'null'}`;
      regionCache.set(key, r.id);
    }
    
    const getOrCreateRegion = (name: string, level: number, parentId: number | null): number | null => {
      if (!name || !name.trim()) return null;
      
      const trimmedName = name.trim();
      const cacheKey = `${level}_${trimmedName}_${parentId || 'null'}`;
      
      if (regionCache.has(cacheKey)) {
        return regionCache.get(cacheKey)!;
      }
      
      // Create new region
      const code = `import_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      
      try {
        querySqlite(`
          INSERT INTO regions (code, name, level, parent_id)
          VALUES (${sqlValue(code)}, ${sqlValue(trimmedName)}, ${sqlValue(level)}, ${parentId ? sqlValue(parentId) : 'NULL'})
        `);
        
        const inserted = querySqlite(`SELECT id FROM regions WHERE code = ${sqlValue(code)}`);
        if (inserted && inserted.length > 0) {
          const newId = inserted[0].id;
          regionCache.set(cacheKey, newId);
          created.push({ level, name: trimmedName, parentName: parentId ? undefined : undefined });
          return newId;
        }
      } catch (err: any) {
        if (!err.message?.includes('UNIQUE constraint failed')) {
          errors.push(`创建 "${trimmedName}" 失败: ${err.message}`);
        }
      }
      
      return null;
    };
    
    // Process each row
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row || row.length === 0) continue;
      
      const [province, city, district, street] = row.map(c => (c || '').toString().trim());
      
      // Skip empty rows
      if (!province) continue;
      
      // Level 1: Province
      const provinceId = getOrCreateRegion(province, 1, null);
      if (!provinceId) continue;
      
      // Level 2: City
      if (city) {
        const cityId = getOrCreateRegion(city, 2, provinceId);
        
        // Level 3: District
        if (district && cityId) {
          const districtId = getOrCreateRegion(district, 3, cityId);
          
          // Level 4: Street
          if (street && districtId) {
            getOrCreateRegion(street, 4, districtId);
          }
        }
      }
    }
    
    // Clean up temp file
    if (filePath) {
      fs.unlinkSync(filePath);
    }
    
    res.json({
      success: true,
      message: `导入完成，新增 ${created.length} 个区域`,
      created: created.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('Import error:', error);
    
    // Clean up temp file
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    res.status(500).json({ error: `导入失败: ${error.message}` });
  }
});

/**
 * GET /api/regions/export
 * Export all regions to Excel
 */
router.get('/export', authMiddleware, (_req: AuthRequest, res: Response) => {
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
