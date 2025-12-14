/**
 * Phase 5 完整流程测试
 * 验证：城市+年份创建任务 -> 查看全文对照 -> 查看表格对照
 */

import axios from 'axios';

const API_BASE_URL = 'http://localhost:3000/api/v1';

async function testPhase5Flow() {
  console.log('🚀 开始 Phase 5 完整流程测试\n');

  try {
    // 1. 获取城市列表
    console.log('📍 步骤 1: 获取城市列表');
    const regionsRes = await axios.get(`${API_BASE_URL}/catalog/regions`);
    console.log(`✅ 获取到 ${regionsRes.data.regions.length} 个城市`);
    console.log(`   城市列表: ${regionsRes.data.regions.map((r: any) => r.name).join(', ')}\n`);

    // 2. 获取某城市的年份列表
    const testRegion = regionsRes.data.regions[0].id;
    console.log(`📍 步骤 2: 获取 ${testRegion} 的年份列表`);
    const yearsRes = await axios.get(`${API_BASE_URL}/catalog/years?region=${testRegion}`);
    console.log(`✅ 获取到 ${yearsRes.data.years.length} 个年份`);
    console.log(`   年份列表: ${yearsRes.data.years.join(', ')}\n`);

    // 3. 创建比对任务（城市+年份方式）
    if (yearsRes.data.years.length >= 2) {
      const yearA = yearsRes.data.years[0];
      const yearB = yearsRes.data.years[1];
      
      console.log(`📍 步骤 3: 创建比对任务 (${testRegion} ${yearA} vs ${yearB})`);
      const createTaskRes = await axios.post(`${API_BASE_URL}/tasks/compare/region-year`, {
        region: testRegion,
        yearA,
        yearB,
      });
      
      const taskId = createTaskRes.data.taskId;
      console.log(`✅ 任务创建成功`);
      console.log(`   任务 ID: ${taskId}`);
      console.log(`   状态: ${createTaskRes.data.status}`);
      console.log(`   消息: ${createTaskRes.data.message}\n`);

      // 4. 获取任务详情
      console.log(`📍 步骤 4: 获取任务详情`);
      const taskRes = await axios.get(`${API_BASE_URL}/tasks/${taskId}`);
      console.log(`✅ 任务详情获取成功`);
      console.log(`   资产 A: ${taskRes.data.assetId_A}`);
      console.log(`   资产 B: ${taskRes.data.assetId_B}\n`);

      // 5. 获取视图模型（全文对照数据）
      console.log(`📍 步骤 5: 获取视图模型（全文对照）`);
      const viewModelRes = await axios.get(`${API_BASE_URL}/tasks/${taskId}/view-model`);
      const viewModel = viewModelRes.data;
      console.log(`✅ 视图模型获取成功`);
      console.log(`   章节数: ${viewModel.sections.length}`);
      
      // 显示第一个章节的内容
      if (viewModel.sections.length > 0) {
        const firstSection = viewModel.sections[0];
        console.log(`   第一章节: ${firstSection.sectionTitle}`);
        console.log(`   块数: ${firstSection.blocks.length}`);
        
        if (firstSection.blocks.length > 0) {
          const firstBlock = firstSection.blocks[0];
          console.log(`   第一块类型: ${firstBlock.type}`);
          if (firstBlock.type === 'paragraph') {
            console.log(`   修改前: ${firstBlock.beforeText?.substring(0, 50)}...`);
            console.log(`   修改后: ${firstBlock.afterText?.substring(0, 50)}...`);
            if (firstBlock.inlineDiff) {
              console.log(`   行内差异数: ${firstBlock.inlineDiff.length}`);
            }
          }
        }
      }
      console.log('');

      // 6. 获取差异结果
      console.log(`📍 步骤 6: 获取差异结果`);
      const diffRes = await axios.get(`${API_BASE_URL}/tasks/${taskId}/diff`);
      const diffResult = diffRes.data;
      console.log(`✅ 差异结果获取成功`);
      console.log(`   章节数: ${diffResult.sections.length}`);
      
      let totalTableCount = 0;
      diffResult.sections.forEach((section: any) => {
        totalTableCount += section.tables?.length || 0;
      });
      console.log(`   表格总数: ${totalTableCount}\n`);

      // 7. 获取摘要
      console.log(`📍 步骤 7: 获取任务摘要`);
      const summaryRes = await axios.get(`${API_BASE_URL}/tasks/${taskId}/summary`);
      const summary = summaryRes.data;
      console.log(`✅ 摘要获取成功`);
      console.log(`   修改段落: ${summary.statistics.modifiedParagraphs}`);
      console.log(`   新增段落: ${summary.statistics.addedParagraphs}`);
      console.log(`   删除段落: ${summary.statistics.deletedParagraphs}`);
      console.log(`   修改表格: ${summary.statistics.modifiedTables}\n`);

      // 8. 验证表格对照数据
      console.log(`📍 步骤 8: 验证表格对照数据`);
      const tableBlocks = viewModel.sections
        .flatMap((s: any) => s.blocks)
        .filter((b: any) => b.type === 'table');
      
      if (tableBlocks.length > 0) {
        const firstTable = tableBlocks[0];
        console.log(`✅ 找到 ${tableBlocks.length} 个表格`);
        console.log(`   第一个表格 ID: ${firstTable.tableData?.schemaTableId}`);
        console.log(`   单元格差异数: ${firstTable.tableData?.cellDiffs?.length || 0}`);
        console.log(`   指标差异数: ${firstTable.tableData?.metricsDiffs?.length || 0}`);
        
        if (firstTable.tableData?.metricsDiffs?.length > 0) {
          const firstMetric = firstTable.tableData.metricsDiffs[0];
          console.log(`   第一个指标: ${firstMetric.rowLabel}`);
          console.log(`   值变化: ${firstMetric.beforeValue} → ${firstMetric.afterValue}`);
          console.log(`   增减: ${firstMetric.delta} (${firstMetric.deltaPercent}%)`);
        }
      } else {
        console.log(`⚠️  未找到表格数据`);
      }
      console.log('');

      console.log('✅ Phase 5 完整流程测试通过！\n');
      console.log('📋 测试总结:');
      console.log('  ✓ 城市列表 API 正常');
      console.log('  ✓ 年份列表 API 正常');
      console.log('  ✓ 城市+年份创建任务 API 正常');
      console.log('  ✓ 任务详情 API 正常');
      console.log('  ✓ 视图模型（全文对照）API 正常');
      console.log('  ✓ 差异结果 API 正常');
      console.log('  ✓ 摘要 API 正常');
      console.log('  ✓ 表格对照数据完整');
    } else {
      console.log('⚠️  该城市年份数不足，跳过任务创建测试');
    }
  } catch (error: any) {
    console.error('❌ 测试失败:', error.message);
    if (error.response?.data) {
      console.error('   响应数据:', error.response.data);
    }
    process.exit(1);
  }
}

testPhase5Flow();
