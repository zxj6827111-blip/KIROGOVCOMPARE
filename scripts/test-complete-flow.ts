/**
 * 完整测试流程：上传、解析、显示
 * 模拟用户在前端上传 PDF 并查看内容的完整流程
 */

import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';

const API_BASE_URL = 'http://localhost:3000/api/v1';

async function testCompleteFlow() {
  console.log('🧪 开始完整流程测试...\n');

  try {
    // 1. 检查健康状态
    console.log('1️⃣  检查后端健康状态...');
    const healthRes = await axios.get('http://localhost:3000/health');
    console.log(`✅ 后端状态: ${healthRes.data.status} (${healthRes.data.mode})\n`);

    // 2. 上传资产（使用真实 PDF 文件的路径）
    console.log('2️⃣  上传资产...');
    const pdfFileName = '上海市黄浦区人民政府2023年政府信息公开工作年度报告.pdf';
    const pdfPath = path.join(__dirname, '../fixtures/sample_pdfs_v1', pdfFileName);
    
    if (!fs.existsSync(pdfPath)) {
      console.error(`❌ PDF 文件不存在: ${pdfPath}`);
      process.exit(1);
    }

    // 通过后台管理 API 上传
    const uploadRes = await axios.post(`${API_BASE_URL}/admin/assets/upload`, {
      regionId: 'huangpu_city',
      year: 2023,
      fileName: pdfFileName,
    });
    const assetId = uploadRes.data.assetId;
    console.log(`✅ 资产已上传: ${assetId}`);
    console.log(`   - 存储路径: ${uploadRes.data.storagePath}\n`);

    // 3. 修改资产的存储路径指向真实 PDF 文件
    // 注意：这是为了测试目的，实际应该在上传时就保存真实路径
    console.log('3️⃣  准备 PDF 文件...');
    console.log(`   - 真实 PDF 路径: ${pdfPath}`);
    console.log(`   - 文件大小: ${fs.statSync(pdfPath).size} 字节\n`);

    // 4. 获取资产详情
    console.log('4️⃣  获取资产详情...');
    const assetRes = await axios.get(`${API_BASE_URL}/assets/${assetId}`);
    console.log(`✅ 资产详情:`);
    console.log(`   - 文件名: ${assetRes.data.fileName}`);
    console.log(`   - 年份: ${assetRes.data.year}`);
    console.log(`   - 地区: ${assetRes.data.region}`);
    console.log(`   - 状态: ${assetRes.data.status}\n`);

    // 5. 获取资产内容（测试 PDF 解析）
    console.log('5️⃣  获取资产内容（测试 PDF 解析）...');
    console.log(`   - 尝试从路径解析: ${pdfPath}`);
    
    let contentRes: any = null;
    try {
      contentRes = await axios.get(`${API_BASE_URL}/assets/${assetId}/content`);
      console.log(`✅ 资产内容已获取\n`);
      
      const sections = contentRes.data.parsedContent.sections;
      console.log(`📊 解析结果:`);
      console.log(`   - 章节数: ${sections.length}`);
      
      if (sections.length > 0) {
        console.log(`\n📋 章节详情:`);
        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          const tableCount = section.tables ? section.tables.length : 0;
          const contentLength = section.content ? section.content.length : 0;
          
          console.log(`\n   ${i + 1}. ${section.title}`);
          console.log(`      - 内容: ${contentLength > 0 ? '✅ 有' : '❌ 无'} (${contentLength} 字符)`);
          console.log(`      - 表格: ${tableCount > 0 ? '✅ 有' : '❌ 无'} (${tableCount} 个)`);
          
          // 显示表格详情
          if (tableCount > 0) {
            for (let j = 0; j < section.tables.length; j++) {
              const table = section.tables[j];
              console.log(`\n        表格 ${j + 1}: ${table.title || '(无标题)'}`);
              console.log(`        - 行数: ${table.rows ? table.rows.length : 0}`);
              console.log(`        - 列数: ${table.columns}`);
              
              // 显示表格的前几行数据
              if (table.rows && table.rows.length > 0) {
                console.log(`        - 数据预览:`);
                for (let k = 0; k < Math.min(2, table.rows.length); k++) {
                  const row = table.rows[k];
                  const cells = row.cells ? row.cells.slice(0, 3) : [];
                  const cellsStr = cells.map((c: any) => {
                    const str = String(c || '');
                    return str.length > 10 ? str.substring(0, 10) + '...' : str;
                  }).join(' | ');
                  console.log(`          行 ${k + 1}: ${cellsStr}${cells.length < (table.columns || 0) ? ' | ...' : ''}`);
                }
                if (table.rows.length > 2) {
                  console.log(`          ... 共 ${table.rows.length} 行`);
                }
              }
            }
          }
        }
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.log(`⚠️  资产内容未找到`);
      } else {
        throw error;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ 测试完成！\n');
    
    // 验证结果
    const sections = contentRes?.data?.parsedContent?.sections || [];
    const hasAllSections = sections.length === 6;
    const hasTables = sections.some((s: any) => s.tables && s.tables.length > 0);
    
    console.log('📊 验证结果:');
    console.log(`   ${hasAllSections ? '✅' : '❌'} 所有 6 个章节已提取`);
    console.log(`   ${hasTables ? '✅' : '❌'} 表格已正确提取`);
    
    if (!hasAllSections || !hasTables) {
      console.log('\n⚠️  部分功能未正常工作');
    } else {
      console.log('\n🎉 所有功能正常！');
    }

  } catch (error: any) {
    console.error('❌ 测试失败:', error.message);
    if (error.response?.data) {
      console.error('   响应:', error.response.data);
    }
    process.exit(1);
  }
}

// 等待后端启动
async function waitForBackend(maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await axios.get('http://localhost:3000/health', { timeout: 1000 });
      return;
    } catch (error) {
      if (i < maxRetries - 1) {
        console.log(`⏳ 等待后端启动... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  throw new Error('后端启动超时');
}

async function main() {
  console.log('🚀 启动完整流程测试...\n');
  
  try {
    await waitForBackend();
    await testCompleteFlow();
  } catch (error) {
    console.error('❌ 错误:', error);
    process.exit(1);
  }
}

main();
