/**
 * 测试完整的 PDF 解析流程
 * 包括上传资产和获取内容
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const API_BASE = 'http://localhost:3000/api/v1';

async function testPdfParsingFlow() {
  console.log('🧪 开始测试 PDF 解析流程...\n');

  try {
    // 1. 查找示例 PDF
    const fixturesDir = path.join(__dirname, '../fixtures/sample_pdfs_v1');
    const pdfFiles = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      console.error('❌ 未找到示例 PDF 文件');
      return;
    }

    const pdfFile = pdfFiles[0];
    console.log(`📄 测试文件: ${pdfFile}\n`);

    // 2. 上传资产
    console.log('📤 上传资产...');
    const uploadRes = await axios.post(`${API_BASE}/assets/upload`, {
      fileName: pdfFile,
      fileSize: 1024000,
      year: 2023,
      region: 'test_region',
    });

    const assetId = uploadRes.data.assetId;
    console.log(`✅ 资产已上传: ${assetId}\n`);

    // 3. 获取资产内容（触发 PDF 解析）
    console.log('📥 获取资产内容（触发 PDF 解析）...');
    const contentRes = await axios.get(`${API_BASE}/assets/${assetId}/content`);

    const content = contentRes.data;
    console.log(`✅ 资产内容已获取\n`);

    // 4. 分析解析结果
    console.log('📊 解析结果分析:\n');
    console.log(`  文件名: ${content.fileName}`);
    console.log(`  年份: ${content.year}`);
    console.log(`  地区: ${content.region}`);
    console.log(`  解析版本: ${content.parseVersion}`);

    const sections = content.parsedContent?.sections || [];
    console.log(`\n  📋 章节数: ${sections.length}`);

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const contentLength = section.content ? section.content.length : 0;
      const tableCount = section.tables ? section.tables.length : 0;

      console.log(`\n  第 ${i + 1} 章: ${section.title}`);
      console.log(`    - 内容长度: ${contentLength} 字符`);
      console.log(`    - 表格数: ${tableCount}`);

      // 显示内容摘要
      if (contentLength > 0) {
        const preview = section.content.substring(0, 100).replace(/\n/g, ' ');
        console.log(`    - 内容摘要: ${preview}...`);
      }

      // 显示表格信息
      if (tableCount > 0) {
        for (let j = 0; j < tableCount; j++) {
          const table = section.tables[j];
          const rowCount = table.rows ? table.rows.length : 0;
          const colCount = table.columns || 0;
          console.log(`    - 表格 ${j + 1}: ${table.title || '无标题'} (${rowCount} 行 x ${colCount} 列)`);

          // 显示表格数据摘要
          if (rowCount > 0 && table.rows[0].cells) {
            const firstRowCells = table.rows[0].cells.slice(0, 3);
            const cellValues = firstRowCells.map((c: any) => c || '-').join(' | ');
            console.log(`      第一行: ${cellValues}`);
          }
        }
      }
    }

    // 5. 检查警告
    if (content.parseWarnings && content.parseWarnings.length > 0) {
      console.log(`\n⚠️  解析警告 (${content.parseWarnings.length} 条):`);
      for (const warning of content.parseWarnings.slice(0, 5)) {
        console.log(`  - [${warning.code}] ${warning.message}`);
      }
    }

    console.log('\n✅ PDF 解析流程测试完成');
  } catch (error: any) {
    console.error('❌ 测试失败:', error.response?.data || error.message);
  }
}

testPdfParsingFlow();
