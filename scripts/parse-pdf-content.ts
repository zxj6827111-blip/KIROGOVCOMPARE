import * as fs from 'fs';
import * as path from 'path';
import PdfParseService from '../src/services/PdfParseService';

/**
 * 解析 PDF 文件并提取内容
 * 用于生成年报详情页面的数据
 */

async function parsePdfContent() {
  const pdfPath = path.join(__dirname, '../fixtures/sample_pdfs_v1/上海市黄浦区人民政府2023年政府信息公开工作年度报告.pdf');
  const altPath = path.join(process.cwd(), 'fixtures/sample_pdfs_v1/上海市黄浦区人民政府2023年政府信息公开工作年度报告.pdf');

  let finalPath = pdfPath;
  if (!fs.existsSync(pdfPath)) {
    if (fs.existsSync(altPath)) {
      finalPath = altPath;
    } else {
      console.error('❌ PDF 文件不存在:', pdfPath);
      console.error('   也不存在:', altPath);
      return;
    }
  }

  console.log('📖 开始解析 PDF...');
  console.log('   路径:', finalPath, '\n');

  try {
    const result = await PdfParseService.parsePDF(finalPath, 'test_asset');

    if (!result.success) {
      console.error('❌ 解析失败:', result.error);
      return;
    }

    const document = result.document!;

    console.log('✅ 解析成功！\n');
    console.log('📊 文档信息:');
    console.log(`  标题: ${document.title}`);
    console.log(`  总页数: ${document.metadata.totalPages}`);
    console.log(`  章节数: ${document.sections.length}\n`);

    // 输出章节信息
    console.log('📑 章节内容:\n');
    for (const section of document.sections) {
      console.log(`\n【${section.title}】`);
      console.log(`  段落数: ${section.content.length}`);
      console.log(`  表格数: ${section.tables.length}`);

      // 输出段落内容
      if (section.content.length > 0) {
        console.log(`\n  段落内容:`);
        section.content.slice(0, 2).forEach((para, idx) => {
          const text = para.text.substring(0, 100);
          console.log(`    ${idx + 1}. ${text}${para.text.length > 100 ? '...' : ''}`);
        });
      }

      // 输出表格信息
      if (section.tables.length > 0) {
        console.log(`\n  表格信息:`);
        section.tables.forEach((table, idx) => {
          console.log(`    ${idx + 1}. ${table.title || '表格'}`);
          console.log(`       行数: ${table.rows.length}, 列数: ${table.columns}`);
          if (table.rows.length > 0) {
            console.log(`       第一行: ${table.rows[0].cells.map(c => c.content).join(' | ')}`);
          }
        });
      }
    }

    // 生成 JSON 格式的数据用于前端
    console.log('\n\n📋 生成前端数据格式...\n');

    const parsedContent = {
      sections: document.sections.map(section => ({
        title: section.title,
        content: section.content.map(p => p.text).join('\n\n'),
        tables: section.tables.map(table => ({
          title: table.title,
          rows: table.rows.map(row => ({
            cells: row.cells.map(cell => cell.content),
          })),
          columns: table.columns,
        })),
      })),
    };

    console.log(JSON.stringify(parsedContent, null, 2));
  } catch (error) {
    console.error('❌ 异常:', error);
  }
}

parsePdfContent();
