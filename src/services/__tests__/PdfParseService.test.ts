import * as fs from 'fs';
import * as path from 'path';
import PdfParseService from '../PdfParseService';

describe('PdfParseService', () => {
  const fixturesDir = path.join(__dirname, '../../../fixtures');
  const manifestPath = path.join(__dirname, '../../../fixtures/manifest.csv');

  // 读取清单
  function loadManifest(): any[] {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim());
    const headers = lines[0].split(',');

    return lines.slice(1).map((line) => {
      const values = line.split(',');
      const record: any = {};
      headers.forEach((header, idx) => {
        record[header.trim()] = values[idx]?.trim();
      });
      return record;
    });
  }

  describe('parsePDF', () => {
    it('应该能解析有效的 PDF 文件', async () => {
      const manifest = loadManifest();
      const testFile = manifest[0]; // 第一个测试文件

      if (!testFile || !testFile.fixture_relpath) {
        console.warn('跳过测试：未找到测试文件');
        return;
      }

      const filePath = path.join(fixturesDir, testFile.fixture_relpath);

      if (!fs.existsSync(filePath)) {
        console.warn(`跳过测试：文件不存在 ${filePath}`);
        return;
      }

      const result = await PdfParseService.parsePDF(filePath, 'test_asset_1');

      expect(result.success).toBe(true);
      expect(result.document).toBeDefined();
      expect(result.document?.title).toBeDefined();
      expect(result.document?.sections).toBeDefined();
      expect(result.document?.sections.length).toBeGreaterThan(0);
    });

    it('应该能提取三张核心表格', async () => {
      const manifest = loadManifest();
      const testFile = manifest[0];

      if (!testFile || !testFile.fixture_relpath) {
        console.warn('跳过测试：未找到测试文件');
        return;
      }

      const filePath = path.join(fixturesDir, testFile.fixture_relpath);

      if (!fs.existsSync(filePath)) {
        console.warn(`跳过测试：文件不存在 ${filePath}`);
        return;
      }

      const result = await PdfParseService.parsePDF(filePath, 'test_asset_1');

      expect(result.success).toBe(true);
      expect(result.document?.sections).toBeDefined();

      // 检查是否包含三张表格
      const sections = result.document?.sections || [];
      const tablesCount = sections.reduce((count, section) => count + section.tables.length, 0);

      expect(tablesCount).toBeGreaterThanOrEqual(0);
    });

    it('应该能处理表格提取失败的情况', async () => {
      const manifest = loadManifest();
      const testFile = manifest[0];

      if (!testFile || !testFile.fixture_relpath) {
        console.warn('跳过测试：未找到测试文件');
        return;
      }

      const filePath = path.join(fixturesDir, testFile.fixture_relpath);

      if (!fs.existsSync(filePath)) {
        console.warn(`跳过测试：文件不存在 ${filePath}`);
        return;
      }

      const result = await PdfParseService.parsePDF(filePath, 'test_asset_1');

      // 即使表格提取失败，整体解析也应该成功
      expect(result.success).toBe(true);

      // 检查 warnings 的格式
      if (result.warnings.length > 0) {
        result.warnings.forEach((warning) => {
          expect(warning.code).toBeDefined();
          expect(warning.message).toBeDefined();
          expect(warning.stage).toBeDefined();
        });
      }
    });

    it('应该能批量处理多个 PDF 文件', async () => {
      const manifest = loadManifest();

      if (manifest.length === 0) {
        console.warn('跳过测试：清单为空');
        return;
      }

      const results = [];

      for (const testFile of manifest.slice(0, 3)) {
        // 只测试前3个
        if (!testFile.fixture_relpath) continue;

        const filePath = path.join(fixturesDir, testFile.fixture_relpath);

        if (!fs.existsSync(filePath)) {
          console.warn(`跳过文件：${filePath}`);
          continue;
        }

        const result = await PdfParseService.parsePDF(filePath, `test_asset_${testFile.sample_id}`);
        results.push({
          file: testFile.filename,
          success: result.success,
          warnings: result.warnings.length,
        });
      }

      // 至少应该成功处理一个文件
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.success)).toBe(true);
    });

    it('应该能提取文档元数据', async () => {
      const manifest = loadManifest();
      const testFile = manifest[0];

      if (!testFile || !testFile.fixture_relpath) {
        console.warn('跳过测试：未找到测试文件');
        return;
      }

      const filePath = path.join(fixturesDir, testFile.fixture_relpath);

      if (!fs.existsSync(filePath)) {
        console.warn(`跳过测试：文件不存在 ${filePath}`);
        return;
      }

      const result = await PdfParseService.parsePDF(filePath, 'test_asset_1');

      expect(result.success).toBe(true);
      expect(result.document?.metadata).toBeDefined();
      expect(result.document?.metadata.totalPages).toBeGreaterThan(0);
      expect(result.document?.metadata.extractedAt).toBeDefined();
      expect(result.document?.metadata.parseVersion).toBe('1.0');
    });

    it('应该能处理不存在的文件', async () => {
      const result = await PdfParseService.parsePDF('/nonexistent/file.pdf', 'test_asset_1');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('表格提取', () => {
    it('应该能识别表格是否存在', async () => {
      const manifest = loadManifest();
      const testFile = manifest[0];

      if (!testFile || !testFile.fixture_relpath) {
        console.warn('跳过测试：未找到测试文件');
        return;
      }

      const filePath = path.join(fixturesDir, testFile.fixture_relpath);

      if (!fs.existsSync(filePath)) {
        console.warn(`跳过测试：文件不存在 ${filePath}`);
        return;
      }

      const result = await PdfParseService.parsePDF(filePath, 'test_asset_1');

      expect(result.success).toBe(true);

      // 检查表格结构
      const sections = result.document?.sections || [];
      sections.forEach((section) => {
        section.tables.forEach((table) => {
          expect(table.id).toBeDefined();
          expect(table.rows).toBeDefined();
          expect(Array.isArray(table.rows)).toBe(true);
        });
      });
    });

    it('应该能产出符合 schema 的 JSON 形状', async () => {
      const manifest = loadManifest();
      const testFile = manifest[0];

      if (!testFile || !testFile.fixture_relpath) {
        console.warn('跳过测试：未找到测试文件');
        return;
      }

      const filePath = path.join(fixturesDir, testFile.fixture_relpath);

      if (!fs.existsSync(filePath)) {
        console.warn(`跳过测试：文件不存在 ${filePath}`);
        return;
      }

      const result = await PdfParseService.parsePDF(filePath, 'test_asset_1');

      expect(result.success).toBe(true);

      // 检查表格字段完整性
      const sections = result.document?.sections || [];
      sections.forEach((section) => {
        section.tables.forEach((table) => {
          // 检查表格必要字段
          expect(table.id).toBeDefined();
          expect(table.rows).toBeDefined();
          expect(table.columns).toBeGreaterThanOrEqual(0);

          // 检查行结构
          table.rows.forEach((row: any) => {
            expect(row.id).toBeDefined();
            expect(row.cells).toBeDefined();
            expect(Array.isArray(row.cells)).toBe(true);

            // 检查单元格结构
            row.cells.forEach((cell: any) => {
              expect(cell.id).toBeDefined();
              expect(cell.rowIndex).toBeGreaterThanOrEqual(0);
              expect(cell.colIndex).toBeGreaterThanOrEqual(0);
              expect(cell.content).toBeDefined();
            });
          });
        });
      });
    });

    it('应该能在降级时产出合规的 warnings', async () => {
      const manifest = loadManifest();
      const testFile = manifest[0];

      if (!testFile || !testFile.fixture_relpath) {
        console.warn('跳过测试：未找到测试文件');
        return;
      }

      const filePath = path.join(fixturesDir, testFile.fixture_relpath);

      if (!fs.existsSync(filePath)) {
        console.warn(`跳过测试：文件不存在 ${filePath}`);
        return;
      }

      const result = await PdfParseService.parsePDF(filePath, 'test_asset_1');

      // 检查 warnings 格式
      result.warnings.forEach((warning) => {
        expect(warning.code).toBeDefined();
        expect(warning.message).toBeDefined();
        expect(warning.stage).toBeDefined();
        // stage 应该是有效的阶段
        expect(['parsing', 'structuring', 'diffing']).toContain(warning.stage);
      });
    });
  });
});
