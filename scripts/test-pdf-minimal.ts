/**
 * 最小 PDF 解析测试脚本
 * 用于验证 PdfParseService 能否成功解析 fixtures 中的 PDF 文件
 */

import * as fs from 'fs';
import * as path from 'path';
import PdfParseService from '../src/services/PdfParseService';

async function main() {
  const fixturesDir = path.join(__dirname, '../fixtures/sample_pdfs_v1');
  
  // 列出 fixtures 目录中的 PDF 文件
  if (!fs.existsSync(fixturesDir)) {
    console.error(`❌ Fixtures 目录不存在: ${fixturesDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.pdf'));
  
  if (files.length === 0) {
    console.error(`❌ 未找到 PDF 文件在: ${fixturesDir}`);
    process.exit(1);
  }

  console.log(`📁 找到 ${files.length} 个 PDF 文件`);
  console.log('');

  // 测试第一个 PDF 文件
  const testFile = files[0];
  const filePath = path.join(fixturesDir, testFile);

  console.log(`🔍 开始解析: ${testFile}`);
  console.log(`📄 文件路径: ${filePath}`);
  console.log('');

  try {
    const result = await PdfParseService.parsePDF(filePath, `test_asset_${Date.now()}`);

    if (result.success) {
      console.log('✅ PDF 解析成功！');
      console.log('');
      console.log('📊 解析结果:');
      console.log(`  - 文档标题: ${result.document?.title}`);
      console.log(`  - 总页数: ${result.document?.metadata.totalPages}`);
      console.log(`  - 章节数: ${result.document?.sections.length}`);
      console.log(`  - 警告数: ${result.warnings.length}`);
      console.log('');

      // 显示表格信息
      if (result.document?.sections) {
        console.log('📋 表格信息:');
        for (const section of result.document.sections) {
          if (section.tables && section.tables.length > 0) {
            console.log(`  - ${section.title}:`);
            for (const table of section.tables) {
              console.log(`    - ${table.title || table.id}`);
              console.log(`      行数: ${table.rows.length}, 列数: ${table.columns}`);
              if (table.rows.length > 0) {
                const firstRow = table.rows[0];
                const firstCell = firstRow.cells[0];
                console.log(`      首行首列: "${firstCell.content}"`);
              }
            }
          }
        }
      }

      console.log('');
      console.log('⚠️  警告信息:');
      if (result.warnings.length === 0) {
        console.log('  (无)');
      } else {
        for (const warning of result.warnings) {
          console.log(`  - [${warning.code}] ${warning.message}`);
        }
      }

      console.log('');
      console.log('✨ 测试完成！');
      process.exit(0);
    } else {
      console.error('❌ PDF 解析失败！');
      console.error(`错误: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ 发生异常:');
    console.error(error);
    process.exit(1);
  }
}

main();
