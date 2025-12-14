/**
 * 测试 PDF 解析功能
 * 验证是否能正确提取所有 6 个章节和表格内容
 */

import * as path from 'path';
import PdfParseService from '../src/services/PdfParseService';

async function testPdfParsing() {
  console.log('🧪 开始测试 PDF 解析功能...\n');

  // 测试文件列表
  const testFiles = [
    '上海市黄浦区人民政府2023年政府信息公开工作年度报告.pdf',
    '上海市黄浦区人民政府2022年政府信息公开工作年度报告（超链版）.pdf',
  ];

  for (const fileName of testFiles) {
    const filePath = path.join(__dirname, '../fixtures/sample_pdfs_v1', fileName);
    
    console.log(`\n📄 测试文件: ${fileName}`);
    console.log('─'.repeat(60));

    try {
      const result = await PdfParseService.parsePDF(filePath, `test_${Date.now()}`);

      if (result.success && result.document) {
        const doc = result.document;
        
        console.log(`✅ 解析成功`);
        console.log(`📊 文档标题: ${doc.title}`);
        console.log(`📑 章节数: ${doc.sections.length}`);
        console.log(`⚠️  警告数: ${result.warnings.length}`);

        // 显示每个章节的信息
        console.log('\n📋 章节详情:');
        for (let i = 0; i < doc.sections.length; i++) {
          const section = doc.sections[i];
          const contentLength = section.content.reduce((sum, p) => sum + p.text.length, 0);
          console.log(`  ${i + 1}. ${section.title}`);
          console.log(`     - 段落数: ${section.content.length}`);
          console.log(`     - 内容字数: ${contentLength}`);
          console.log(`     - 表格数: ${section.tables.length}`);
          
          // 显示表格信息
          if (section.tables.length > 0) {
            for (let j = 0; j < section.tables.length; j++) {
              const table = section.tables[j];
              console.log(`       表格 ${j + 1}: ${table.title || '(无标题)'}`);
              console.log(`       - 行数: ${table.rows.length}`);
              console.log(`       - 列数: ${table.columns}`);
            }
          }
        }

        // 显示警告信息
        if (result.warnings.length > 0) {
          console.log('\n⚠️  警告信息:');
          for (const warning of result.warnings) {
            console.log(`  - [${warning.code}] ${warning.message}`);
          }
        }

        // 验证是否有所有 6 个章节
        if (doc.sections.length === 6) {
          console.log('\n✅ 成功提取所有 6 个章节！');
        } else {
          console.log(`\n⚠️  章节数不符（期望 6 个，实际 ${doc.sections.length} 个）`);
        }

        // 验证第一个章节是否有内容
        if (doc.sections.length > 0 && doc.sections[0].content.length > 0) {
          const firstSection = doc.sections[0];
          const firstParagraph = firstSection.content[0];
          console.log(`\n📝 第一章节第一段内容预览:`);
          console.log(`   ${firstParagraph.text.substring(0, 100)}...`);
        }

        // 验证是否有表格
        const totalTables = doc.sections.reduce((sum, s) => sum + s.tables.length, 0);
        console.log(`\n📊 总表格数: ${totalTables}`);

      } else {
        console.log(`❌ 解析失败: ${result.error}`);
      }
    } catch (error) {
      console.error(`❌ 异常: ${error}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ 测试完成');
}

testPdfParsing().catch(console.error);
