import * as fs from 'fs';
import * as path from 'path';
import PdfParseService from '../src/services/PdfParseService';

/**
 * 测试表格提取 v2
 * 验证：
 * 1. 28行10列的精确匹配（三、收到和处理政府信息公开申请情况）
 * 2. 分页处理
 * 3. 数字类型识别
 */
async function testTableExtractionV2() {
  console.log('=== 表格提取 v2 测试 ===\n');

  // 查找测试 PDF 文件
  const fixturesDir = path.join(__dirname, '../fixtures');
  if (!fs.existsSync(fixturesDir)) {
    console.error('❌ fixtures 目录不存在');
    return;
  }

  const pdfFiles = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.pdf'));
  if (pdfFiles.length === 0) {
    console.error('❌ 没有找到 PDF 文件');
    return;
  }

  console.log(`📄 找到 ${pdfFiles.length} 个 PDF 文件\n`);

  for (const pdfFile of pdfFiles) {
    const pdfPath = path.join(fixturesDir, pdfFile);
    console.log(`\n📖 处理: ${pdfFile}`);
    console.log('─'.repeat(60));

    try {
      const result = await PdfParseService.parsePDF(pdfPath, `test_${pdfFile}`);

      if (!result.success) {
        console.error(`❌ 解析失败: ${result.error}`);
        continue;
      }

      const document = result.document!;
      console.log(`✓ 文档标题: ${document.title}`);
      console.log(`✓ 总页数: ${document.metadata.totalPages}`);
      console.log(`✓ 章节数: ${document.sections.length}`);

      // 检查表格
      let totalTables = 0;
      for (const section of document.sections) {
        totalTables += section.tables.length;
      }
      console.log(`✓ 总表格数: ${totalTables}\n`);

      // 详细检查"三、收到和处理政府信息公开申请情况"表格
      const section3 = document.sections.find(s => s.title.includes('三、'));
      if (section3 && section3.tables.length > 0) {
        console.log('📊 第三章表格详情:');
        for (const table of section3.tables) {
          console.log(`\n  表格: ${table.title}`);
          console.log(`  ID: ${table.id}`);
          console.log(`  行数: ${table.rows.length}`);
          console.log(`  列数: ${table.columns}`);

          // 检查是否是 28 行 10 列
          if (table.id === 'sec3_requests') {
            const isCorrectSize = table.rows.length === 28 && table.columns === 10;
            console.log(`  ${isCorrectSize ? '✓' : '❌'} 精确度: ${table.rows.length} 行 × ${table.columns} 列 ${isCorrectSize ? '(完美!)' : '(不匹配)'}`);

            // 检查数字类型
            let numberCount = 0;
            let totalCells = 0;
            for (const row of table.rows) {
              for (const cell of row.cells) {
                totalCells++;
                if (typeof cell.value === 'number') {
                  numberCount++;
                }
              }
            }
            console.log(`  数字类型: ${numberCount}/${totalCells} 单元格 (${((numberCount / totalCells) * 100).toFixed(1)}%)`);

            // 显示前 3 行数据
            console.log(`\n  前 3 行数据:`);
            for (let i = 0; i < Math.min(3, table.rows.length); i++) {
              const row = table.rows[i];
              console.log(`    行 ${i + 1}: ${row.rowLabel}`);
              const values = row.cells.map(c => `${c.value}`).join(' | ');
              console.log(`      ${values}`);
            }
          }
        }
      }

      // 显示警告信息
      if (result.warnings.length > 0) {
        console.log(`\n⚠️  警告信息 (${result.warnings.length} 条):`);
        for (const warning of result.warnings) {
          console.log(`  • [${warning.code}] ${warning.message}`);
        }
      }
    } catch (error) {
      console.error(`❌ 异常: ${error}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✓ 测试完成');
}

testTableExtractionV2().catch(console.error);
