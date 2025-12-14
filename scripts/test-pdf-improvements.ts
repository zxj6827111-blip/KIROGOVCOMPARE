/**
 * 测试脚本：验证 PDF 解析改进的效果
 * 
 * 测试项：
 * 1. 文本重构准确性（动态阈值）
 * 2. 表格定位准确性（坐标范围）
 * 3. 跨页表格处理
 * 4. 页脚识别
 * 5. 行数据有效性验证
 */

import * as fs from 'fs';
import * as path from 'path';
import PdfParseService from '../src/services/PdfParseService';

interface TestMetrics {
  pdfName: string;
  textExtractionQuality: number; // 0-100
  tableLocalizationAccuracy: number; // 0-100
  crossPageTableHandling: number; // 0-100
  footerDetection: number; // 0-100
  rowDataValidity: number; // 0-100
  overallScore: number; // 0-100
  warnings: string[];
  errors: string[];
}

async function testPdfImprovements() {
  const sampleDir = path.join(__dirname, '../fixtures/sample_pdfs_v1');
  const pdfFiles = fs.readdirSync(sampleDir).filter(f => f.endsWith('.pdf'));

  console.log(`\n🔬 开始测试 PDF 解析改进，共 ${pdfFiles.length} 个 PDF 文件\n`);

  const results: TestMetrics[] = [];

  for (const pdfFile of pdfFiles) {
    const pdfPath = path.join(sampleDir, pdfFile);
    console.log(`\n📊 测试: ${pdfFile}`);

    try {
      const result = await PdfParseService.parsePDF(pdfPath, `test_${pdfFile}`);

      if (!result.success || !result.document) {
        console.log(`  ❌ 解析失败: ${result.error}`);
        results.push({
          pdfName: pdfFile,
          textExtractionQuality: 0,
          tableLocalizationAccuracy: 0,
          crossPageTableHandling: 0,
          footerDetection: 0,
          rowDataValidity: 0,
          overallScore: 0,
          warnings: result.warnings.map(w => w.message),
          errors: [result.error || '未知错误'],
        });
        continue;
      }

      const doc = result.document;

      // 1. 文本提取质量评估
      let textQuality = 0;
      const totalSections = doc.sections.length;
      const nonEmptySections = doc.sections.filter(s => s.content.length > 0).length;
      textQuality = (nonEmptySections / totalSections) * 100;
      console.log(`  ├─ 文本提取质量: ${textQuality.toFixed(1)}% (${nonEmptySections}/${totalSections} 章节有内容)`);

      // 2. 表格定位准确性评估
      let tableAccuracy = 0;
      const expectedTables = ['sec2_art20_1', 'sec2_art20_5', 'sec2_art20_6', 'sec2_art20_8', 'sec3_requests', 'sec4_review_litigation'];
      const foundTables = new Set<string>();
      
      for (const section of doc.sections) {
        for (const table of section.tables) {
          foundTables.add(table.id);
        }
      }
      
      const foundCount = expectedTables.filter(id => foundTables.has(id)).length;
      tableAccuracy = (foundCount / expectedTables.length) * 100;
      console.log(`  ├─ 表格定位准确性: ${tableAccuracy.toFixed(1)}% (${foundCount}/${expectedTables.length} 表格找到)`);

      // 3. 跨页表格处理评估
      let crossPageScore = 0;
      const crossPageWarnings = result.warnings.filter(w => w.code === 'TABLE_SPANS_PAGES');
      if (crossPageWarnings.length > 0) {
        // 如果有跨页表格警告，说明系统识别到了跨页情况
        crossPageScore = 80; // 基础分
        console.log(`  ├─ 跨页表格处理: ${crossPageScore}% (检测到 ${crossPageWarnings.length} 个跨页表格)`);
      } else {
        crossPageScore = 100; // 没有跨页表格或处理完美
        console.log(`  ├─ 跨页表格处理: ${crossPageScore}% (无跨页表格或处理完美)`);
      }

      // 4. 页脚识别评估
      let footerScore = 100;
      const footerRelatedWarnings = result.warnings.filter(w => 
        w.message.includes('页脚') || w.message.includes('footer')
      );
      if (footerRelatedWarnings.length > 0) {
        footerScore = 70;
      }
      console.log(`  ├─ 页脚识别: ${footerScore}% (${footerRelatedWarnings.length} 个页脚相关警告)`);

      // 5. 行数据有效性评估
      let rowValidity = 0;
      let totalRows = 0;
      let validRows = 0;
      
      for (const section of doc.sections) {
        for (const table of section.tables) {
          totalRows += table.rows.length;
          // 简单的有效性检查：行中至少有一个非空单元格
          for (const row of table.rows) {
            const hasContent = row.cells.some(cell => cell.content && cell.content.toString().trim() !== '');
            if (hasContent) validRows++;
          }
        }
      }
      
      if (totalRows > 0) {
        rowValidity = (validRows / totalRows) * 100;
      } else {
        rowValidity = 100; // 没有表格时认为有效
      }
      console.log(`  ├─ 行数据有效性: ${rowValidity.toFixed(1)}% (${validRows}/${totalRows} 行有效)`);

      // 计算总体评分
      const overallScore = (textQuality + tableAccuracy + crossPageScore + footerScore + rowValidity) / 5;
      console.log(`  └─ 总体评分: ${overallScore.toFixed(1)}/100`);

      results.push({
        pdfName: pdfFile,
        textExtractionQuality: textQuality,
        tableLocalizationAccuracy: tableAccuracy,
        crossPageTableHandling: crossPageScore,
        footerDetection: footerScore,
        rowDataValidity: rowValidity,
        overallScore: overallScore,
        warnings: result.warnings.map(w => w.message),
        errors: [],
      });

    } catch (error) {
      console.log(`  ❌ 异常: ${error}`);
      results.push({
        pdfName: pdfFile,
        textExtractionQuality: 0,
        tableLocalizationAccuracy: 0,
        crossPageTableHandling: 0,
        footerDetection: 0,
        rowDataValidity: 0,
        overallScore: 0,
        warnings: [],
        errors: [`${error}`],
      });
    }
  }

  // 生成报告
  console.log('\n\n📈 测试报告\n');
  console.log('='.repeat(100));

  const avgTextQuality = results.reduce((sum, r) => sum + r.textExtractionQuality, 0) / results.length;
  const avgTableAccuracy = results.reduce((sum, r) => sum + r.tableLocalizationAccuracy, 0) / results.length;
  const avgCrossPage = results.reduce((sum, r) => sum + r.crossPageTableHandling, 0) / results.length;
  const avgFooter = results.reduce((sum, r) => sum + r.footerDetection, 0) / results.length;
  const avgRowValidity = results.reduce((sum, r) => sum + r.rowDataValidity, 0) / results.length;
  const avgOverall = results.reduce((sum, r) => sum + r.overallScore, 0) / results.length;

  console.log(`\n📊 平均指标:`);
  console.log(`  文本提取质量: ${avgTextQuality.toFixed(1)}%`);
  console.log(`  表格定位准确性: ${avgTableAccuracy.toFixed(1)}%`);
  console.log(`  跨页表格处理: ${avgCrossPage.toFixed(1)}%`);
  console.log(`  页脚识别: ${avgFooter.toFixed(1)}%`);
  console.log(`  行数据有效性: ${avgRowValidity.toFixed(1)}%`);
  console.log(`  总体评分: ${avgOverall.toFixed(1)}/100\n`);

  console.log(`📋 详细结果:`);
  for (const result of results) {
    console.log(`\n  📄 ${result.pdfName}`);
    console.log(`     文本提取: ${result.textExtractionQuality.toFixed(1)}%`);
    console.log(`     表格定位: ${result.tableLocalizationAccuracy.toFixed(1)}%`);
    console.log(`     跨页处理: ${result.crossPageTableHandling.toFixed(1)}%`);
    console.log(`     页脚识别: ${result.footerDetection.toFixed(1)}%`);
    console.log(`     行数据: ${result.rowDataValidity.toFixed(1)}%`);
    console.log(`     总体: ${result.overallScore.toFixed(1)}/100`);

    if (result.warnings.length > 0) {
      console.log(`     ⚠️  警告: ${result.warnings.length} 个`);
    }
    if (result.errors.length > 0) {
      console.log(`     ❌ 错误: ${result.errors.length} 个`);
    }
  }

  console.log('\n' + '='.repeat(100));

  // 保存详细报告
  const reportPath = path.join(__dirname, '../test-pdf-improvements-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      totalPdfs: results.length,
      avgTextQuality,
      avgTableAccuracy,
      avgCrossPage,
      avgFooter,
      avgRowValidity,
      avgOverall,
    },
    results,
  }, null, 2));

  console.log(`\n✅ 测试完成，报告已保存到: ${reportPath}\n`);
}

// 运行测试
testPdfImprovements().catch(error => {
  console.error('测试失败:', error);
  process.exit(1);
});
