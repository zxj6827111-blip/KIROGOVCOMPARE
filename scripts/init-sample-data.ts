import axios from 'axios';

/**
 * 初始化示例数据
 * 添加黄浦区地区和示例年报
 */

const API_BASE = 'http://localhost:3000/api/v1';

async function initData() {
  console.log('🚀 开始初始化示例数据...\n');

  try {
    // 1. 检查黄浦区是否已存在
    console.log('📍 检查黄浦区地区...');
    const regionsRes = await axios.get(`${API_BASE}/admin/regions`);
    const regions = regionsRes.data.regions || [];
    const huangpuExists = regions.some(r => r.regionId === 'huangpu_city');

    if (!huangpuExists) {
      console.log('➕ 添加黄浦区地区...');
      await axios.post(`${API_BASE}/admin/regions`, {
        regionId: 'huangpu_city',
        name: '黄浦区',
        level: 'city',
        parentId: 'shanghai_prov',
      });
      console.log('✅ 黄浦区添加成功\n');
    } else {
      console.log('✅ 黄浦区已存在\n');
    }

    // 2. 添加示例年报
    console.log('📤 添加示例年报...');
    const reports = [
      {
        regionId: 'huangpu_city',
        year: 2022,
        fileName: '上海市黄浦区人民政府2022年政府信息公开工作年度报告（超链版）.pdf',
      },
      {
        regionId: 'huangpu_city',
        year: 2023,
        fileName: '上海市黄浦区人民政府2023年政府信息公开工作年度报告.pdf',
      },
    ];

    for (const report of reports) {
      try {
        console.log(`  📄 上传: ${report.fileName}`);
        await axios.post(`${API_BASE}/admin/assets/upload`, {
          regionId: report.regionId,
          year: report.year,
          fileName: report.fileName,
        });
        console.log(`  ✅ 上传成功\n`);
      } catch (error) {
        console.warn(`  ⚠️  上传失败: ${error}\n`);
      }
    }

    console.log('✅ 初始化完成！');
    console.log('\n📍 后台管理地址: http://localhost:3000/admin');
    console.log('📍 前端地址: http://localhost:3001');
  } catch (error) {
    console.error('❌ 初始化失败:', error);
  }
}

initData();
