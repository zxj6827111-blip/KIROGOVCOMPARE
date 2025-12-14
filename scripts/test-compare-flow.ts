/**
 * 完整比对流程测试脚本
 * 用于验证从 PDF 解析到差异比对的完整流程
 */

import * as fs from 'fs';
import * as path from 'path';
import PdfParseService from '../src/services/PdfParseService';
import StructuringService from '../src/services/StructuringService';
import DiffService from '../src/services/DiffService';
import SummaryService from '../src/services/SummaryService';

async function main() {
  const fixturesDir = path.join(__dirname, '../fixtures/sample_pdfs_v1');

  // 列出 fixtures 目录中的 PDF 文件
  if (!fs.existsSync(fixturesDir)) {
    console.error(`❌ Fixtures 目录不存在: ${fixturesDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.pdf'));

  if (files.length < 2) {
    console.error(`❌ 需要至少 2 个 PDF 文件进行比对，当前找到 ${files.length} 个`);
    process.exit(1);
  }

  console.log(`📁 找到 ${files.length} 个 PDF 文件`);
  console.log('');

  // 选择两个不同年度的文件进行比对
  const file1 = files[0];
  const file2 = files[1];
  const filePath1 = path.join(fixturesDir, file1);
  const filePath2 = path.join(fixturesDir, file2);

  console.log(`🔍 开始完整比对流程`);
  console.log(`📄 文件 1: ${file1}`);
  console.log(`📄 文件 2: ${file2}`);
  console.log('');

  try {
    // 第一步：解析两个 PDF
    console.log('📖 第一步：解析 PDF 文件...');
    const parseResult1 = await PdfParseService.parsePDF(filePath1, `asset_1_${Date.now()}`);
    const parseResult2 = await PdfParseService.parsePDF(filePath2, `asset_2_${Date.now()}`);

    if (!parseResult1.success || !parseResult2.success) {
      console.error('❌ PDF 解析失败');
      console.error(`文件 1: ${parseResult1.error || '成功'}`);
      console.error(`文件 2: ${parseResult2.error || '成功'}`);
      process.exit(1);
    }

    console.log('✅ PDF 解析成功');
    console.log(`  - 文件 1: ${parseResult1.document?.sections.length} 个章节`);
    console.log(`  - 文件 2: ${parseResult2.document?.sections.length} 个章节`);
    console.log('');

    // 第二步：结构化文档
    console.log('🏗️  第二步：结构化文档...');
    const structResult1 = await StructuringService.structureDocument(parseResult1);
    const structResult2 = await StructuringService.structureDocument(parseResult2);

    if (!structResult1.success || !structResult2.success) {
      console.error('❌ 文档结构化失败');
      process.exit(1);
    }

    console.log('✅ 文档结构化成功');
    console.log('');

    // 第三步：比对文档
    console.log('🔄 第三步：比对文档...');
    const diffResult = await DiffService.diffDocuments(
      structResult1.document!,
      structResult2.document!
    );

    console.log('✅ 文档比对成功');
    console.log(`  - 章节数: ${diffResult.sections.length}`);

    // 统计差异
    let totalParagraphChanges = 0;
    let totalTableChanges = 0;

    for (const section of diffResult.sections) {
      totalParagraphChanges += section.paragraphs.length;
      totalTableChanges += section.tables.length;
    }

    console.log(`  - 段落差异: ${totalParagraphChanges}`);
    console.log(`  - 表格差异: ${totalTableChanges}`);
    console.log('');

    // 第四步：生成摘要
    console.log('📊 第四步：生成差异摘要...');
    const summary = SummaryService.generateSummary(diffResult);

    console.log('✅ 摘要生成成功');
    console.log(`  - 变化最多的章节数: ${summary.topChangedSections.length}`);
    console.log(`  - 新增段落: ${summary.statistics.addedParagraphs}`);
    console.log(`  - 删除段落: ${summary.statistics.deletedParagraphs}`);
    console.log(`  - 修改段落: ${summary.statistics.modifiedParagraphs}`);
    console.log(`  - 新增表格: ${summary.statistics.addedTables}`);
    console.log(`  - 删除表格: ${summary.statistics.deletedTables}`);
    console.log(`  - 修改表格: ${summary.statistics.modifiedTables}`);
    console.log('');

    // 显示表格差异详情
    console.log('📋 表格差异详情:');
    for (const section of diffResult.sections) {
      if (section.tables.length > 0) {
        console.log(`  ${section.sectionTitle}:`);
        for (const table of section.tables) {
          console.log(`    - ${table.tableId}: ${table.cellChanges.length} 个单元格变化`);
          
          // 显示前几个单元格变化
          for (let i = 0; i < Math.min(3, table.cellChanges.length); i++) {
            const change = table.cellChanges[i];
            const rowLabel = change.rowLabel || `行 ${change.rowIndex}`;
            const colName = change.colName || `列 ${change.colIndex}`;
            
            if (change.type === 'modified') {
              console.log(`      [修改] ${rowLabel} / ${colName}: "${change.before}" → "${change.after}"`);
            } else if (change.type === 'added') {
              console.log(`      [新增] ${rowLabel} / ${colName}: "${change.after}"`);
            } else if (change.type === 'deleted') {
              console.log(`      [删除] ${rowLabel} / ${colName}: "${change.before}"`);
            }
          }
          
          if (table.cellChanges.length > 3) {
            console.log(`      ... 还有 ${table.cellChanges.length - 3} 个变化`);
          }
        }
      }
    }

    console.log('');
    console.log('✨ 完整比对流程测试完成！');
    console.log('');
    console.log('📈 流程总结:');
    console.log(`  ✅ PDF 解析: 2 个文件`);
    console.log(`  ✅ 文档结构化: 2 个文档`);
    console.log(`  ✅ 差异比对: ${totalParagraphChanges} 个段落差异, ${totalTableChanges} 个表格差异`);
    console.log(`  ✅ 摘要生成: ${summary.topChangedSections.length} 个变化最多的章节`);

    process.exit(0);
  } catch (error) {
    console.error('❌ 发生异常:');
    console.error(error);
    process.exit(1);
  }
}

main();
