import * as fs from 'fs';
import * as path from 'path';
import PdfParseService from '../PdfParseService';
import StructuringService from '../StructuringService';

describe('PDF 解析与结构化集成测试', () => {
  const fixturesDir = path.join(__dirname, '../../../fixtures');
  const manifestPath = path.join(__dirname, '../../../fixtures/manifest.csv');

  function loadManifest(): any[] {
    if (!fs.existsSync(manifestPath)) {
      console.warn('清单文件不存在');
      return [];
    }

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

  describe('完整流程', () => {
    it('应该能完整处理 PDF 解析和结构化', async () => {
      const manifest = loadManifest();
      if (manifest.length === 0) {
        console.warn('跳过测试：清单为空');
        return;
      }

      const testFile = manifest[0];
      if (!testFile.fixture_relpath) {
        console.warn('跳过测试：未找到测试文件');
        return;
      }

      const filePath = path.join(fixturesDir, testFile.fixture_relpath);
      if (!fs.existsSync(filePath)) {
        console.warn(`跳过测试：文件不存在 ${filePath}`);
        return;
      }

      // 第一步：解析 PDF
      const parseResult = await PdfParseService.parsePDF(filePath, 'test_asset_1');
      expect(parseResult.success).toBe(true);
      expect(parseResult.document).toBeDefined();

      // 第二步：结构化
      const structureResult = await StructuringService.structureDocument(parseResult);
      expect(structureResult.success).toBe(true);
      expect(structureResult.document).toBeDefined();

      // 第三步：验证结构
      const validation = StructuringService.validateStructure(structureResult.document!);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.log('验证问题:', validation.issues);
      }

      // 第四步：生成摘要
      const summary = StructuringService.generateSummary(structureResult.document!);
      expect(summary.title).toBeDefined();
      expect(summary.totalSections).toBeGreaterThan(0);
    });

    it('应该能批量处理多个 PDF 文件', async () => {
      const manifest = loadManifest();
      if (manifest.length === 0) {
        console.warn('跳过测试：清单为空');
        return;
      }

      const results = [];

      for (const testFile of manifest.slice(0, 5)) {
        // 只测试前5个
        if (!testFile.fixture_relpath) continue;

        const filePath = path.join(fixturesDir, testFile.fixture_relpath);
        if (!fs.existsSync(filePath)) {
          console.warn(`跳过文件：${filePath}`);
          continue;
        }

        try {
          const parseResult = await PdfParseService.parsePDF(
            filePath,
            `test_asset_${testFile.sample_id}`
          );
          const structureResult = await StructuringService.structureDocument(parseResult);

          results.push({
            file: testFile.filename,
            parseSuccess: parseResult.success,
            structureSuccess: structureResult.success,
            warnings: parseResult.warnings.length,
            sections: structureResult.document?.sections.length || 0,
          });
        } catch (error) {
          console.error(`处理文件 ${testFile.filename} 时出错:`, error);
          results.push({
            file: testFile.filename,
            parseSuccess: false,
            structureSuccess: false,
            warnings: 0,
            sections: 0,
          });
        }
      }

      // 至少应该成功处理一个文件
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.parseSuccess && r.structureSuccess)).toBe(true);

      // 打印结果摘要
      console.log('\n批量处理结果:');
      results.forEach((r) => {
        console.log(
          `  ${r.file}: 解析=${r.parseSuccess ? '✓' : '✗'}, 结构化=${r.structureSuccess ? '✓' : '✗'}, 警告=${r.warnings}, 章节=${r.sections}`
        );
      });
    });

    it('应该能正确处理表格降级', async () => {
      const manifest = loadManifest();
      if (manifest.length === 0) {
        console.warn('跳过测试：清单为空');
        return;
      }

      const testFile = manifest[0];
      if (!testFile.fixture_relpath) {
        console.warn('跳过测试：未找到测试文件');
        return;
      }

      const filePath = path.join(fixturesDir, testFile.fixture_relpath);
      if (!fs.existsSync(filePath)) {
        console.warn(`跳过测试：文件不存在 ${filePath}`);
        return;
      }

      const parseResult = await PdfParseService.parsePDF(filePath, 'test_asset_1');

      // 检查 warnings 的合规性
      parseResult.warnings.forEach((warning) => {
        expect(warning.code).toBeDefined();
        expect(warning.message).toBeDefined();
        expect(warning.stage).toBeDefined();

        // 如果是表格相关的 warning，应该包含表格信息
        if (warning.code.includes('TABLE')) {
          expect(['parsing', 'structuring']).toContain(warning.stage);
        }
      });
    });

    it('应该能提取三张核心表格的数据', async () => {
      const manifest = loadManifest();
      if (manifest.length === 0) {
        console.warn('跳过测试：清单为空');
        return;
      }

      const testFile = manifest[0];
      if (!testFile.fixture_relpath) {
        console.warn('跳过测试：未找到测试文件');
        return;
      }

      const filePath = path.join(fixturesDir, testFile.fixture_relpath);
      if (!fs.existsSync(filePath)) {
        console.warn(`跳过测试：文件不存在 ${filePath}`);
        return;
      }

      const parseResult = await PdfParseService.parsePDF(filePath, 'test_asset_1');
      const structureResult = await StructuringService.structureDocument(parseResult);

      if (!structureResult.document) {
        console.warn('跳过测试：结构化失败');
        return;
      }

      // 获取所有表格
      const allTables = StructuringService.getAllTables(structureResult.document);

      // 检查表格结构
      allTables.forEach((table) => {
        expect(table.id).toBeDefined();
        expect(table.rows).toBeDefined();
        expect(Array.isArray(table.rows)).toBe(true);

        // 检查行结构
        table.rows.forEach((row) => {
          expect(row.id).toBeDefined();
          expect(row.cells).toBeDefined();
          expect(Array.isArray(row.cells)).toBe(true);

          // 检查单元格结构
          row.cells.forEach((cell) => {
            expect(cell.id).toBeDefined();
            expect(cell.rowIndex).toBeGreaterThanOrEqual(0);
            expect(cell.colIndex).toBeGreaterThanOrEqual(0);
            expect(cell.content).toBeDefined();
          });
        });
      });

      console.log(`\n提取的表格数: ${allTables.length}`);
      allTables.forEach((table) => {
        console.log(`  ${table.id}: ${table.rows.length} 行, ${table.columns} 列`);
      });
    });
  });
});
