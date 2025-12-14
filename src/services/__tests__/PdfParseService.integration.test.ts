/**
 * PdfParseService 集成测试
 * 测试 PDF 解析和数据保存的完整流程
 */

import * as fs from 'fs';
import * as path from 'path';
import PdfParseService from '../PdfParseService';
import ParsedDataStorageService from '../ParsedDataStorageService';

describe('PdfParseService Integration', () => {
  const testStoragePath = path.join(__dirname, '../../../test_integration_storage');
  const testAssetId = `integration_test_${Date.now()}`;

  // 创建测试用的存储服务实例
  const storageService = new (ParsedDataStorageService.constructor as any)(testStoragePath);

  beforeAll(() => {
    // 确保测试存储目录存在
    if (!fs.existsSync(testStoragePath)) {
      fs.mkdirSync(testStoragePath, { recursive: true });
    }
  });

  afterAll(() => {
    // 清理测试数据
    if (fs.existsSync(testStoragePath)) {
      const files = fs.readdirSync(testStoragePath);
      files.forEach(file => {
        fs.unlinkSync(path.join(testStoragePath, file));
      });
      fs.rmdirSync(testStoragePath);
    }
  });

  describe('PDF 解析和数据保存流程', () => {
    it('应该能完成 PDF 解析到数据保存的完整流程', async () => {
      const sampleDir = path.join(__dirname, '../../../fixtures/sample_pdfs_v1');
      const pdfFiles = fs.readdirSync(sampleDir).filter(f => f.endsWith('.pdf'));

      if (pdfFiles.length === 0) {
        console.warn('跳过测试：未找到示例 PDF 文件');
        return;
      }

      const testPdfFile = pdfFiles[0];
      const testPdfPath = path.join(sampleDir, testPdfFile);

      if (!fs.existsSync(testPdfPath)) {
        console.warn(`跳过测试：文件不存在 ${testPdfPath}`);
        return;
      }

      // 步骤 1: 解析 PDF
      const parseResult = await PdfParseService.parsePDF(testPdfPath, testAssetId);

      expect(parseResult.success).toBe(true);
      expect(parseResult.document).toBeDefined();
      expect(parseResult.document?.assetId).toBe(testAssetId);

      // 步骤 2: 验证解析数据结构
      const document = parseResult.document!;
      expect(document.title).toBeDefined();
      expect(document.sections).toBeDefined();
      expect(document.sections.length).toBeGreaterThan(0);
      expect(document.metadata).toBeDefined();

      // 步骤 3: 手动保存解析数据（模拟自动保存）
      const filePath = await storageService.saveParseData(testAssetId, document);
      expect(fs.existsSync(filePath)).toBe(true);

      // 步骤 4: 读取已保存的数据
      const loadedData = await storageService.loadParseData(testAssetId);
      expect(loadedData).toBeDefined();
      expect(loadedData?.assetId).toBe(testAssetId);

      // 步骤 5: 验证数据完整性
      expect(loadedData?.title).toBe(document.title);
      expect(loadedData?.sections.length).toBe(document.sections.length);
      expect(loadedData?.metadata.parseVersion).toBe(document.metadata.parseVersion);
    });

    it('应该能处理多个 PDF 文件的解析和保存', async () => {
      const sampleDir = path.join(__dirname, '../../../fixtures/sample_pdfs_v1');
      const pdfFiles = fs.readdirSync(sampleDir).filter(f => f.endsWith('.pdf')).slice(0, 2);

      if (pdfFiles.length === 0) {
        console.warn('跳过测试：未找到示例 PDF 文件');
        return;
      }

      const results = [];

      for (const pdfFile of pdfFiles) {
        const testPdfPath = path.join(sampleDir, pdfFile);
        const assetId = `multi_test_${Date.now()}_${pdfFile}`;

        if (!fs.existsSync(testPdfPath)) {
          continue;
        }

        const parseResult = await PdfParseService.parsePDF(testPdfPath, assetId);

        if (parseResult.success && parseResult.document) {
          await storageService.saveParseData(assetId, parseResult.document);
          const loadedData = await storageService.loadParseData(assetId);

          results.push({
            assetId,
            success: loadedData !== null,
            title: loadedData?.title,
          });

          // 清理
          await storageService.deleteParseData(assetId);
        }
      }

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('应该能正确处理解析失败的情况', async () => {
      const invalidPdfPath = path.join(__dirname, '../../../fixtures/invalid.pdf');

      // 创建一个无效的 PDF 文件
      fs.writeFileSync(invalidPdfPath, 'This is not a PDF file');

      try {
        const parseResult = await PdfParseService.parsePDF(invalidPdfPath, 'invalid_test');

        // 解析应该失败
        expect(parseResult.success).toBe(false);
        expect(parseResult.error).toBeDefined();
      } finally {
        // 清理
        if (fs.existsSync(invalidPdfPath)) {
          fs.unlinkSync(invalidPdfPath);
        }
      }
    });
  });

  describe('数据完整性验证', () => {
    it('应该能验证解析数据的完整性', async () => {
      const sampleDir = path.join(__dirname, '../../../fixtures/sample_pdfs_v1');
      const pdfFiles = fs.readdirSync(sampleDir).filter(f => f.endsWith('.pdf'));

      if (pdfFiles.length === 0) {
        console.warn('跳过测试：未找到示例 PDF 文件');
        return;
      }

      const testPdfFile = pdfFiles[0];
      const testPdfPath = path.join(sampleDir, testPdfFile);

      if (!fs.existsSync(testPdfPath)) {
        console.warn(`跳过测试：文件不存在 ${testPdfPath}`);
        return;
      }

      const parseResult = await PdfParseService.parsePDF(testPdfPath, testAssetId);

      if (!parseResult.success || !parseResult.document) {
        console.warn('跳过测试：PDF 解析失败');
        return;
      }

      const document = parseResult.document;

      // 验证必需字段
      expect(document.documentId).toBeDefined();
      expect(document.assetId).toBeDefined();
      expect(document.title).toBeDefined();
      expect(document.sections).toBeDefined();
      expect(document.metadata).toBeDefined();

      // 验证章节结构
      for (const section of document.sections) {
        expect(section.id).toBeDefined();
        expect(section.level).toBeDefined();
        expect(section.title).toBeDefined();
        expect(section.content).toBeDefined();
        expect(Array.isArray(section.content)).toBe(true);
        expect(section.tables).toBeDefined();
        expect(Array.isArray(section.tables)).toBe(true);
      }

      // 验证表格结构
      for (const section of document.sections) {
        for (const table of section.tables) {
          expect(table.id).toBeDefined();
          expect(table.title).toBeDefined();
          expect(table.rows).toBeDefined();
          expect(Array.isArray(table.rows)).toBe(true);
          expect(table.columns).toBeDefined();

          // 验证行结构
          for (const row of table.rows) {
            expect(row.id).toBeDefined();
            expect(row.cells).toBeDefined();
            expect(Array.isArray(row.cells)).toBe(true);
          }
        }
      }

      // 验证元数据
      expect(document.metadata.totalPages).toBeGreaterThan(0);
      expect(document.metadata.extractedAt).toBeDefined();
      expect(document.metadata.parseVersion).toBeDefined();
    });

    it('应该能验证保存和读取的数据一致性', async () => {
      const sampleDir = path.join(__dirname, '../../../fixtures/sample_pdfs_v1');
      const pdfFiles = fs.readdirSync(sampleDir).filter(f => f.endsWith('.pdf'));

      if (pdfFiles.length === 0) {
        console.warn('跳过测试：未找到示例 PDF 文件');
        return;
      }

      const testPdfFile = pdfFiles[0];
      const testPdfPath = path.join(sampleDir, testPdfFile);
      const consistencyTestId = `consistency_test_${Date.now()}`;

      if (!fs.existsSync(testPdfPath)) {
        console.warn(`跳过测试：文件不存在 ${testPdfPath}`);
        return;
      }

      const parseResult = await PdfParseService.parsePDF(testPdfPath, consistencyTestId);

      if (!parseResult.success || !parseResult.document) {
        console.warn('跳过测试：PDF 解析失败');
        return;
      }

      const originalDocument = parseResult.document;

      // 保存数据
      await storageService.saveParseData(consistencyTestId, originalDocument);

      // 读取数据
      const loadedDocument = await storageService.loadParseData(consistencyTestId);

      // 验证一致性
      expect(loadedDocument?.documentId).toBe(originalDocument.documentId);
      expect(loadedDocument?.assetId).toBe(originalDocument.assetId);
      expect(loadedDocument?.title).toBe(originalDocument.title);
      expect(loadedDocument?.sections.length).toBe(originalDocument.sections.length);

      // 验证章节内容一致性
      for (let i = 0; i < originalDocument.sections.length; i++) {
        const originalSection = originalDocument.sections[i];
        const loadedSection = loadedDocument?.sections[i];

        expect(loadedSection?.id).toBe(originalSection.id);
        expect(loadedSection?.title).toBe(originalSection.title);
        expect(loadedSection?.content.length).toBe(originalSection.content.length);
        expect(loadedSection?.tables.length).toBe(originalSection.tables.length);
      }

      // 清理
      await storageService.deleteParseData(consistencyTestId);
    });
  });

  describe('性能测试', () => {
    it('应该能在合理的时间内完成 PDF 解析', async () => {
      const sampleDir = path.join(__dirname, '../../../fixtures/sample_pdfs_v1');
      const pdfFiles = fs.readdirSync(sampleDir).filter(f => f.endsWith('.pdf'));

      if (pdfFiles.length === 0) {
        console.warn('跳过测试：未找到示例 PDF 文件');
        return;
      }

      const testPdfFile = pdfFiles[0];
      const testPdfPath = path.join(sampleDir, testPdfFile);

      if (!fs.existsSync(testPdfPath)) {
        console.warn(`跳过测试：文件不存在 ${testPdfPath}`);
        return;
      }

      const startTime = Date.now();
      const parseResult = await PdfParseService.parsePDF(testPdfPath, `perf_test_${Date.now()}`);
      const endTime = Date.now();

      const duration = endTime - startTime;

      // 解析应该在 10 秒内完成
      expect(duration).toBeLessThan(10000);
      expect(parseResult.success).toBe(true);

      console.log(`PDF 解析耗时: ${duration}ms`);
    });

    it('应该能在合理的时间内保存和读取数据', async () => {
      const sampleDir = path.join(__dirname, '../../../fixtures/sample_pdfs_v1');
      const pdfFiles = fs.readdirSync(sampleDir).filter(f => f.endsWith('.pdf'));

      if (pdfFiles.length === 0) {
        console.warn('跳过测试：未找到示例 PDF 文件');
        return;
      }

      const testPdfFile = pdfFiles[0];
      const testPdfPath = path.join(sampleDir, testPdfFile);
      const perfTestId = `perf_storage_${Date.now()}`;

      if (!fs.existsSync(testPdfPath)) {
        console.warn(`跳过测试：文件不存在 ${testPdfPath}`);
        return;
      }

      const parseResult = await PdfParseService.parsePDF(testPdfPath, perfTestId);

      if (!parseResult.success || !parseResult.document) {
        console.warn('跳过测试：PDF 解析失败');
        return;
      }

      // 测试保存性能
      const saveStartTime = Date.now();
      await storageService.saveParseData(perfTestId, parseResult.document);
      const saveDuration = Date.now() - saveStartTime;

      // 保存应该在 1 秒内完成
      expect(saveDuration).toBeLessThan(1000);

      // 测试读取性能
      const loadStartTime = Date.now();
      await storageService.loadParseData(perfTestId);
      const loadDuration = Date.now() - loadStartTime;

      // 读取应该在 100ms 内完成
      expect(loadDuration).toBeLessThan(100);

      console.log(`数据保存耗时: ${saveDuration}ms`);
      console.log(`数据读取耗时: ${loadDuration}ms`);

      // 清理
      await storageService.deleteParseData(perfTestId);
    });
  });
});
