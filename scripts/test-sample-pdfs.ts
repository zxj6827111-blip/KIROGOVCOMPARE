/**
 * 回归测试脚本：使用 fixtures/sample_pdfs_v1 中的真实 PDF 验证
 * 
 * 验证项：
 * 1. 表格 shape 一致性（多次解析同一 PDF）
 * 2. 章节内容完整性（二/三/四章节 content 非空）
 * 3. v2 schema 表格存在（table.id 全部存在）
 * 4. 表格行列数正确（章节三 25 行 × 7 列，章节四 1 行 × 15 列）
 */

import * as fs from 'fs';
import * as path from 'path';
import PdfParseService from '../src/services/PdfParseService';

interface TestResult {
  pdfName: string;
  success: boolean;
  sections: number;
  tables: number;
  tableShapes: Array<{ id: string; rows: number; cols: number }>;
  sectionContents: Array<{ title: string; paragraphs: number }>;
  warnings: string[];
  errors: string[];
}

async function testSamplePdfs() {
  const sampleDir = path.join(__dirname, '../fixtures/sample_pdfs_v1');
  const pdfFiles = fs.readdirSync(sampleDir).filter(f => f.endsWith('.pdf'));

  console.log(`\n📋 开始回归测试，共 ${pdfFiles.length} 个 PDF 文件\n`);

  const results: TestResult[] = [];

  for (const pdfFile of pdfFiles) {
    const pdfPath = path.join(sampleDir, pdfFile);
    console.log(`\n🔍 测试: ${pdfFile}`);

    try {
      // 第一次解析
      console.log('  ├─ 第一次解析...');
      const result1 = await PdfParseService.parsePDF(pdfPath, `asset_1_${pdfFile}`);

      if (!result1.success || !result1.document) {
        console.log(`  ├─ ❌ 解析失败: ${result1.error}`);
        results.push({
          pdfName: pdfFile,
          success: false,
          sections: 0,
          tables: 0,
          tableShapes: [],
          sectionContents: [],
          warnings: result1.warnings.map(w => w.message),
          errors: [result1.error || '未知错误'],
        });
        continue;
      }

      const doc1 = result1.document;
      console.log(`  ├─ ✅ 解析成功`);
      console.log(`  ├─ 章节数: ${doc1.sections.length}`);

      // 统计表格 shape
      const tableShapes1: Array<{ id: string; rows: number; cols: number }> = [];
      for (const section of doc1.sections) {
        for (const table of section.tables) {
          tableShapes1.push({
            id: table.id,
            rows: table.rows.length,
            cols: table.columns,
          });
        }
      }
      console.log(`  ├─ 表格数: ${tableShapes1.length}`);
      tableShapes1.forEach(t => {
        console.log(`  │  ├─ ${t.id}: ${t.rows} 行 × ${t.cols} 列`);
      });

      // 统计章节内容
      const sectionContents: Array<{ title: string; paragraphs: number }> = [];
      for (const section of doc1.sections) {
        sectionContents.push({
          title: section.title,
          paragraphs: section.content.length,
        });
        console.log(`  │  ├─ ${section.title}: ${section.content.length} 段落`);
      }

      // 第二次解析（验证一致性）
      console.log('  ├─ 第二次解析（验证一致性）...');
      const result2 = await PdfParseService.parsePDF(pdfPath, `asset_2_${pdfFile}`);

      if (!result2.success || !result2.document) {
        console.log(`  ├─ ❌ 第二次解析失败`);
        results.push({
          pdfName: pdfFile,
          success: false,
          sections: doc1.sections.length,
          tables: tableShapes1.length,
          tableShapes: tableShapes1,
          sectionContents,
          warnings: result1.warnings.map(w => w.message),
          errors: [result2.error || '第二次解析失败'],
        });
        continue;
      }

      const doc2 = result2.document;

      // 验证表格 shape 一致性
      const tableShapes2: Array<{ id: string; rows: number; cols: number }> = [];
      for (const section of doc2.sections) {
        for (const table of section.tables) {
          tableShapes2.push({
            id: table.id,
            rows: table.rows.length,
            cols: table.columns,
          });
        }
      }

      let shapeConsistent = true;
      if (tableShapes1.length !== tableShapes2.length) {
        shapeConsistent = false;
        console.log(`  ├─ ⚠️  表格数不一致: ${tableShapes1.length} vs ${tableShapes2.length}`);
      } else {
        for (let i = 0; i < tableShapes1.length; i++) {
          const t1 = tableShapes1[i];
          const t2 = tableShapes2[i];
          if (t1.rows !== t2.rows || t1.cols !== t2.cols) {
            shapeConsistent = false;
            console.log(`  ├─ ⚠️  表格 ${t1.id} shape 不一致: (${t1.rows}×${t1.cols}) vs (${t2.rows}×${t2.cols})`);
          }
        }
      }

      if (shapeConsistent) {
        console.log(`  ├─ ✅ 表格 shape 一致`);
      }

      // 验证 v2 schema 表格
      const requiredTableIds = ['sec2_art20_1', 'sec2_art20_5', 'sec2_art20_6', 'sec2_art20_8', 'sec3_requests', 'sec4_review_litigation'];
      const foundTableIds = new Set(tableShapes1.map(t => t.id));
      const missingTableIds = requiredTableIds.filter(id => !foundTableIds.has(id));

      if (missingTableIds.length > 0) {
        console.log(`  ├─ ⚠️  缺少表格: ${missingTableIds.join(', ')}`);
      } else {
        console.log(`  ├─ ✅ v2 schema 表格全部存在`);
      }

      // 验证表格行列数
      const sec3Table = tableShapes1.find(t => t.id === 'sec3_requests');
      const sec4Table = tableShapes1.find(t => t.id === 'sec4_review_litigation');

      if (sec3Table && sec3Table.rows === 25 && sec3Table.cols === 7) {
        console.log(`  ├─ ✅ 章节三表格: 25 行 × 7 列`);
      } else if (sec3Table) {
        console.log(`  ├─ ⚠️  章节三表格: ${sec3Table.rows} 行 × ${sec3Table.cols} 列 (期望 25×7)`);
      }

      if (sec4Table && sec4Table.rows === 1 && sec4Table.cols === 15) {
        console.log(`  ├─ ✅ 章节四表格: 1 行 × 15 列`);
      } else if (sec4Table) {
        console.log(`  ├─ ⚠️  章节四表格: ${sec4Table.rows} 行 × ${sec4Table.cols} 列 (期望 1×15)`);
      }

      // 验证章节内容完整性
      const sec2 = doc1.sections.find(s => s.title.includes('二、'));
      const sec3 = doc1.sections.find(s => s.title.includes('三、'));
      const sec4 = doc1.sections.find(s => s.title.includes('四、'));

      let contentComplete = true;
      if (!sec2 || sec2.content.length === 0) {
        console.log(`  ├─ ⚠️  章节二内容为空`);
        contentComplete = false;
      } else {
        console.log(`  ├─ ✅ 章节二: ${sec2.content.length} 段落`);
      }

      if (!sec3 || sec3.content.length === 0) {
        console.log(`  ├─ ⚠️  章节三内容为空`);
        contentComplete = false;
      } else {
        console.log(`  ├─ ✅ 章节三: ${sec3.content.length} 段落`);
      }

      if (!sec4 || sec4.content.length === 0) {
        console.log(`  ├─ ⚠️  章节四内容为空`);
        contentComplete = false;
      } else {
        console.log(`  ├─ ✅ 章节四: ${sec4.content.length} 段落`);
      }

      results.push({
        pdfName: pdfFile,
        success: shapeConsistent && contentComplete && missingTableIds.length === 0,
        sections: doc1.sections.length,
        tables: tableShapes1.length,
        tableShapes: tableShapes1,
        sectionContents,
        warnings: result1.warnings.map(w => w.message),
        errors: [],
      });

      console.log(`  └─ ${shapeConsistent && contentComplete && missingTableIds.length === 0 ? '✅ 通过' : '⚠️  部分失败'}`);
    } catch (error) {
      console.log(`  └─ ❌ 异常: ${error}`);
      results.push({
        pdfName: pdfFile,
        success: false,
        sections: 0,
        tables: 0,
        tableShapes: [],
        sectionContents: [],
        warnings: [],
        errors: [`${error}`],
      });
    }
  }

  // 生成报告
  console.log('\n\n📊 测试报告\n');
  console.log('='.repeat(80));

  const passCount = results.filter(r => r.success).length;
  const totalCount = results.length;

  console.log(`总体: ${passCount}/${totalCount} 通过\n`);

  for (const result of results) {
    console.log(`📄 ${result.pdfName}`);
    console.log(`   状态: ${result.success ? '✅ 通过' : '❌ 失败'}`);
    console.log(`   章节: ${result.sections}, 表格: ${result.tables}`);

    if (result.tableShapes.length > 0) {
      console.log(`   表格详情:`);
      result.tableShapes.forEach(t => {
        console.log(`     - ${t.id}: ${t.rows}×${t.cols}`);
      });
    }

    if (result.warnings.length > 0) {
      console.log(`   警告:`);
      result.warnings.forEach(w => {
        console.log(`     - ${w}`);
      });
    }

    if (result.errors.length > 0) {
      console.log(`   错误:`);
      result.errors.forEach(e => {
        console.log(`     - ${e}`);
      });
    }

    console.log();
  }

  console.log('='.repeat(80));
  console.log(`\n✅ 测试完成: ${passCount}/${totalCount} 通过\n`);

  // 保存详细报告
  const reportPath = path.join(__dirname, '../test-sample-pdfs-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`📝 详细报告已保存到: ${reportPath}\n`);
}

// 运行测试
testSamplePdfs().catch(error => {
  console.error('测试失败:', error);
  process.exit(1);
});
