#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';
import PdfParseService from '../src/services/PdfParseService';
import StructuringService from '../src/services/StructuringService';

async function main() {
  const fixturesDir = path.join(__dirname, '../fixtures/sample_pdfs_v1');
  const manifestPath = path.join(__dirname, '../fixtures/manifest.csv');

  console.log('📋 PDF 解析与结构化验证脚本\n');

  // 读取清单
  if (!fs.existsSync(manifestPath)) {
    console.error('❌ 清单文件不存在:', manifestPath);
    process.exit(1);
  }

  const content = fs.readFileSync(manifestPath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim());
  const headers = lines[0].split(',');

  const manifest = lines.slice(1).map((line) => {
    const values = line.split(',');
    const record: any = {};
    headers.forEach((header, idx) => {
      record[header.trim()] = values[idx]?.trim();
    });
    return record;
  });

  console.log(`📁 找到 ${manifest.length} 个测试文件\n`);

  let successCount = 0;
  let failureCount = 0;
  const results: any[] = [];

  for (const testFile of manifest) {
    if (!testFile.fixture_relpath) continue;

    const filePath = path.join(fixturesDir, testFile.fixture_relpath);

    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  文件不存在: ${testFile.filename}`);
      failureCount++;
      continue;
    }

    try {
      console.log(`🔄 处理: ${testFile.filename}`);

      // 解析 PDF
      const parseResult = await PdfParseService.parsePDF(filePath, `asset_${testFile.sample_id}`);

      if (!parseResult.success) {
        console.error(`  ❌ 解析失败: ${parseResult.error}`);
        failureCount++;
        results.push({
          file: testFile.filename,
          status: 'failed',
          reason: parseResult.error,
        });
        continue;
      }

      // 结构化
      const structureResult = await StructuringService.structureDocument(parseResult);

      if (!structureResult.success) {
        console.error(`  ❌ 结构化失败: ${structureResult.error}`);
        failureCount++;
        results.push({
          file: testFile.filename,
          status: 'failed',
          reason: structureResult.error,
        });
        continue;
      }

      // 验证结构
      const validation = StructuringService.validateStructure(structureResult.document!);

      if (!validation.valid) {
        console.warn(`  ⚠️  结构验证问题:`);
        validation.issues.forEach((issue) => console.warn(`    - ${issue}`));
      }

      // 生成摘要
      const summary = StructuringService.generateSummary(structureResult.document!);
      const allTables = StructuringService.getAllTables(structureResult.document!);

      console.log(`  ✅ 成功`);
      console.log(`    📄 标题: ${summary.title}`);
      console.log(`    📊 章节: ${summary.totalSections}, 表格: ${summary.totalTables}, 段落: ${summary.totalParagraphs}`);
      console.log(`    ⚠️  警告: ${parseResult.warnings.length}`);

      if (parseResult.warnings.length > 0) {
        parseResult.warnings.forEach((w) => {
          console.log(`      - [${w.code}] ${w.message}`);
        });
      }

      successCount++;
      results.push({
        file: testFile.filename,
        status: 'success',
        year: testFile.year,
        region: testFile.region,
        sections: summary.totalSections,
        tables: allTables.length,
        warnings: parseResult.warnings.length,
      });
    } catch (error) {
      console.error(`  ❌ 异常: ${error}`);
      failureCount++;
      results.push({
        file: testFile.filename,
        status: 'error',
        reason: String(error),
      });
    }

    console.log();
  }

  // 打印总结
  console.log('\n📊 处理结果总结\n');
  console.log(`✅ 成功: ${successCount}`);
  console.log(`❌ 失败: ${failureCount}`);
  console.log(`📈 成功率: ${((successCount / (successCount + failureCount)) * 100).toFixed(1)}%\n`);

  // 按状态分类打印
  const successResults = results.filter((r) => r.status === 'success');
  const failedResults = results.filter((r) => r.status !== 'success');

  if (successResults.length > 0) {
    console.log('✅ 成功处理的文件:');
    successResults.forEach((r) => {
      console.log(
        `  ${r.file}: ${r.year} ${r.region} (${r.sections}章, ${r.tables}表, ${r.warnings}警告)`
      );
    });
  }

  if (failedResults.length > 0) {
    console.log('\n❌ 失败的文件:');
    failedResults.forEach((r) => {
      console.log(`  ${r.file}: ${r.reason}`);
    });
  }

  process.exit(failureCount > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('脚本执行失败:', error);
  process.exit(1);
});
