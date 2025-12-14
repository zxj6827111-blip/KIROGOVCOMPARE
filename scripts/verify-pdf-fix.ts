/**
 * 验证 PDF 坐标提取修复
 * 完整的端到端测试
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const API_BASE = 'http://localhost:3000/api/v1';

async function verifyPdfFix() {
  console.log('🔍 验证 PDF 坐标提取修复\n');
  console.log('=' .repeat(60));

  try {
    // 1. 查找示例 PDF
    const fixturesDir = path.join(__dirname, '../fixtures/sample_pdfs_v1');
    const pdfFiles = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      console.error('❌ 未找到示例 PDF 文件');
      return;
    }

    const pdfFile = pdfFiles[0];
    console.log(`\n📄 测试文件: ${pdfFile}`);
    console.log('=' .repeat(60));

    // 2. 上传资产
    console.log('\n📤 步骤 1: 上传资产');
    const uploadRes = await axios.post(`${API_BASE}/assets/upload`, {
      fileName: pdfFile,
      fileSize: 1024000,
      year: 2023,
      region: 'test_region',
    });

    const assetId = uploadRes.data.assetId;
    console.log(`✅ 资产已上传: ${assetId}`);

    // 3. 获取资产内容
    console.log('\n📥 步骤 2: 获取资产内容（触发 PDF 解析）');
    const contentRes = await axios.get(`${API_BASE}/assets/${assetId}/content`);
    const content = contentRes.data;
    console.log(`✅ 资产内容已获取`);

    // 4. 验证章节
    console.log('\n📋 步骤 3: 验证章节提取');
    const sections = content.parsedContent?.sections || [];
    console.log(`✅ 提取了 ${sections.length} 个章节`);

    const expectedSections = [
      '一、概述',
      '二、主动公开政府信息情况',
      '三、收到和处理政府信息公开申请情况',
      '四、因政府信息公开工作被申请行政复议、提起行政诉讼情况',
      '五、政府信息公开工作存在的主要问题及改进情况',
      '六、其他需要报告的事项',
    ];

    let allSectionsFound = true;
    for (const expectedTitle of expectedSections) {
      const found = sections.some((s: any) => s.title.includes(expectedTitle.substring(0, 5)));
      const status = found ? '✅' : '❌';
      console.log(`  ${status} ${expectedTitle}`);
      if (!found) allSectionsFound = false;
    }

    // 5. 验证文本内容
    console.log('\n📝 步骤 4: 验证文本内容提取');
    let totalContentLength = 0;
    let sectionsWithContent = 0;

    for (const section of sections) {
      if (section.content && section.content.length > 0) {
        totalContentLength += section.content.length;
        sectionsWithContent++;
      }
    }

    console.log(`✅ ${sectionsWithContent} 个章节有文本内容`);
    console.log(`✅ 总文本长度: ${totalContentLength} 字符`);

    // 6. 验证表格
    console.log('\n📊 步骤 5: 验证表格提取');
    let totalTables = 0;
    let tablesWithData = 0;

    for (const section of sections) {
      if (section.tables && section.tables.length > 0) {
        totalTables += section.tables.length;
        for (const table of section.tables) {
          if (table.rows && table.rows.length > 0) {
            const firstRow = table.rows[0];
            if (firstRow.cells && firstRow.cells.length > 0) {
              const hasData = firstRow.cells.some((c: any) => c && c !== '-');
              if (hasData) {
                tablesWithData++;
              }
            }
          }
        }
      }
    }

    console.log(`✅ 提取了 ${totalTables} 个表格`);
    console.log(`✅ ${tablesWithData} 个表格有真实数据`);

    // 7. 显示表格样本
    console.log('\n📐 步骤 6: 表格数据样本');
    for (const section of sections) {
      if (section.tables && section.tables.length > 0) {
        console.log(`\n  ${section.title}:`);
        for (let i = 0; i < section.tables.length; i++) {
          const table = section.tables[i];
          const rowCount = table.rows ? table.rows.length : 0;
          const colCount = table.columns || 0;
          console.log(`    表格 ${i + 1}: ${table.title || '无标题'} (${rowCount} 行 x ${colCount} 列)`);

          if (rowCount > 0 && table.rows[0].cells) {
            const firstRowCells = table.rows[0].cells.slice(0, 3);
            const cellValues = firstRowCells.map((c: any) => c || '-').join(' | ');
            console.log(`      第一行: ${cellValues}`);
          }
        }
      }
    }

    // 8. 总结
    console.log('\n' + '=' .repeat(60));
    console.log('✅ 验证完成\n');

    const allChecks = [
      ['章节提取', allSectionsFound && sections.length === 6],
      ['文本内容', sectionsWithContent > 0 && totalContentLength > 0],
      ['表格提取', totalTables > 0],
      ['表格数据', tablesWithData > 0],
    ];

    console.log('📋 验证结果:');
    let allPassed = true;
    for (const [check, passed] of allChecks) {
      const status = passed ? '✅' : '❌';
      console.log(`  ${status} ${check}`);
      if (!passed) allPassed = false;
    }

    console.log('\n' + '=' .repeat(60));
    if (allPassed) {
      console.log('🎉 所有验证通过！PDF 坐标提取修复成功！\n');
    } else {
      console.log('⚠️  部分验证未通过\n');
    }
  } catch (error: any) {
    console.error('❌ 验证失败:', error.response?.data || error.message);
  }
}

verifyPdfFix();
