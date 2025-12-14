/**
 * 实现验证脚本
 * 用于快速验证 schema v2 和完整比对流程是否正常工作
 */

import * as fs from 'fs';
import * as path from 'path';
import PdfParseService from '../src/services/PdfParseService';
import StructuringService from '../src/services/StructuringService';
import DiffService from '../src/services/DiffService';
import SummaryService from '../src/services/SummaryService';

async function main() {
  console.log('🚀 开始验证实现...\n');

  const fixturesDir = path.join(__dirname, '../fixtures/sample_pdfs_v1');

  // 检查 fixtures 目录
  if (!fs.existsSync(fixturesDir)) {
    console.error(`❌ Fixtures 目录不存在: ${fixturesDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.pdf'));

  if (files.length < 2) {
    console.error(`❌ 需要至少 2 个 PDF 文件进行比对，当前找到 ${files.length} 个`);
    process.exit(1);
  }

  console.log(`✅ 找到 ${files.length} 个 PDF 文件\n`);

  // 选择两个不同年度的文件
  const file1 = files[0];
  const file2 = files[1];
  const filePath1 = path.join(fixturesDir, file1);
  const filePath2 = path.join(fixturesDir, file2);

  console.log(`📄 文件 1: ${file1}`);
  console.log(`📄 文件 2: ${file2}\n`);

  try {
    // 步骤 1: 解析 PDF
    console.log('📖 步骤 1: 解析 PDF 文件...');
    const parseResult1 = await PdfParseService.parsePDF(filePath1, `asset_1_${Date.now()}`);
    const parseResult2 = await PdfParseService.parsePDF(filePath2, `asset_2_${Date.now()}`);

    if (!parseResult1.success || !parseResult2.success) {
      console.error('❌ PDF 解析失败');
      if (parseResult1.error) console.error(`  文件 1: ${parseResult1.error}`);
      if (parseResult2.error) console.error(`  文件 2: ${parseResult2.error}`);
      process.exit(1);
    }

    console.log('✅ PDF 解析成功');
    console.log(`  - 文件 1: ${parseResult1.document?.sections.length} 个章节`);
    console.log(`  - 文件 2: ${parseResult2.document?.sections.length} 个章节`);
    
    // 显示表格信息
    if (parseResult1.document?.sections) {
      let tableCount = 0;
      for (const section of parseResult1.document.sections) {
        tableCount += section.tables?.length || 0;
      }
      console.log(`  - 文件 1 表格数: ${tableCount}`);
    }
    
    if (parseResult2.document?.sections) {
      let tableCount = 0;
      for (const section of parseResult2.document.sections) {
        tableCount += section.tables?.length || 0;
      }
      console.log(`  - 文件 2 表格数: ${tableCount}`);
    }

    // 显示警告
    if (parseResult1.warnings.length > 0) {
      console.log(`  ⚠️  文件 1 警告: ${parseResult1.warnings.length} 条`);
      for (const warning of parseResult1.warnings.slice(0, 3)) {
        console.log(`     - [${warning.code}] ${warning.message}`);
      }
    }

    if (parseResult2.warnings.length > 0) {
      console.log(`  ⚠️  文件 2 警告: ${parseResult2.warnings.length} 条`);
      for (const warning of parseResult2.warnings.slice(0, 3)) {
        console.log(`     - [${warning.code}] ${warning.message}`);
      }
    }

    console.log('');

    // 步骤 2: 结构化文档
    console.log('🏗️  步骤 2: 结构化文档...');
    const structResult1 = await StructuringService.structureDocument(parseResult1);
    const structResult2 = await StructuringService.structureDocument(parseResult2);

    if (!structResult1.success || !structResult2.success) {
      console.error('❌ 文档结构化失败');
      process.exit(1);
    }

    console.log('✅ 文档结构化成功\n');

    // 步骤 3: 比对文档
    console.log('🔄 步骤 3: 比对文档...');
    const diffResult = await DiffService.diffDocuments(
      structResult1.document!,
      structResult2.document!
    );

    console.log('✅ 文档比对成功');

    // 统计差异
    let totalParagraphChanges = 0;
    let totalTableChanges = 0;
    let totalCellChanges = 0;

    for (const section of diffResult.sections) {
      totalParagraphChanges += section.paragraphs.length;
      totalTableChanges += section.tables.length;
      for (const table of section.tables) {
        totalCellChanges += table.cellChanges.length;
      }
    }

    console.log(`  - 段落差异: ${totalParagraphChanges}`);
    console.log(`  - 表格差异: ${totalTableChanges}`);
    console.log(`  - 单元格变化: ${totalCellChanges}`);
    console.log('');

    // 步骤 4: 生成摘要
    console.log('📊 步骤 4: 生成差异摘要...');
    const summary = SummaryService.generateSummary(diffResult);

    console.log('✅ 摘要生成成功');
    console.log(`  - 变化最多的章节: ${summary.topChangedSections.length}`);
    console.log(`  - 新增段落: ${summary.statistics.addedParagraphs}`);
    console.log(`  - 删除段落: ${summary.statistics.deletedParagraphs}`);
    console.log(`  - 修改段落: ${summary.statistics.modifiedParagraphs}`);
    console.log(`  - 新增表格: ${summary.statistics.addedTables}`);
    console.log(`  - 删除表格: ${summary.statistics.deletedTables}`);
    console.log(`  - 修改表格: ${summary.statistics.modifiedTables}`);
    console.log('');

    // 显示表格差异详情
    console.log('📋 表格差异详情:');
    let hasTableChanges = false;
    for (const section of diffResult.sections) {
      if (section.tables.length > 0) {
        hasTableChanges = true;
        console.log(`  📌 ${section.sectionTitle}:`);
        for (const table of section.tables) {
          console.log(`     表格: ${table.tableId}`);
          console.log(`     类型: ${table.type}`);
          console.log(`     单元格变化: ${table.cellChanges.length}`);
          
          // 显示前 5 个单元格变化
          for (let i = 0; i < Math.min(5, table.cellChanges.length); i++) {
            const change = table.cellChanges[i];
            const rowLabel = change.rowLabel || `行 ${change.rowIndex}`;
            const colName = change.colName || `列 ${change.colIndex}`;
            
            if (change.type === 'modified') {
              console.log(`       [修改] ${rowLabel} / ${colName}: "${change.before}" → "${change.after}"`);
            } else if (change.type === 'added') {
              console.log(`       [新增] ${rowLabel} / ${colName}: "${change.after}"`);
            } else if (change.type === 'deleted') {
              console.log(`       [删除] ${rowLabel} / ${colName}: "${change.before}"`);
            }
          }
          
          if (table.cellChanges.length > 5) {
            console.log(`       ... 还有 ${table.cellChanges.length - 5} 个变化`);
          }
        }
      }
    }

    if (!hasTableChanges) {
      console.log('  (无表格差异)');
    }

    console.log('');
    console.log('✨ 验证完成！\n');
    console.log('📈 流程总结:');
    console.log(`  ✅ PDF 解析: 2 个文件`);
    console.log(`  ✅ 文档结构化: 2 个文档`);
    console.log(`  ✅ 差异比对: ${totalParagraphChanges} 个段落差异, ${totalTableChanges} 个表格差异`);
    console.log(`  ✅ 摘要生成: ${summary.topChangedSections.length} 个变化最多的章节`);
    console.log('');
    console.log('🎉 所有功能正常工作！');

    process.exit(0);
  } catch (error) {
    console.error('❌ 发生异常:');
    console.error(error);
    process.exit(1);
  }
}

main();
