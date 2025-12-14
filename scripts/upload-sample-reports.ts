import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

/**
 * 上传示例年报文件到后台
 * 用于演示和测试
 */

const API_BASE = 'http://localhost:3000/api/v1';

// 要上传的文件列表
const filesToUpload = [
  {
    filePath: 'fixtures/sample_pdfs_v1/上海市黄浦区人民政府2022年政府信息公开工作年度报告（超链版）.pdf',
    regionId: 'huangpu_city',
    year: 2022,
  },
  {
    filePath: 'fixtures/sample_pdfs_v1/上海市黄浦区人民政府2023年政府信息公开工作年度报告.pdf',
    regionId: 'huangpu_city',
    year: 2023,
  },
];

async function uploadReports() {
  console.log('🚀 开始上传示例年报...\n');

  for (const item of filesToUpload) {
    const fullPath = path.join(__dirname, '..', item.filePath);

    if (!fs.existsSync(fullPath)) {
      console.warn(`⚠️  文件不存在: ${fullPath}`);
      continue;
    }

    try {
      console.log(`📤 上传: ${item.filePath}`);
      console.log(`   地区: ${item.regionId}, 年份: ${item.year}`);

      // 读取文件
      const fileBuffer = fs.readFileSync(fullPath);
      const fileName = path.basename(fullPath);

      // 创建 FormData
      const formData = new FormData();
      const blob = new Blob([fileBuffer], { type: 'application/pdf' });
      formData.append('file', blob, fileName);
      formData.append('regionId', item.regionId);
      formData.append('year', item.year.toString());

      // 上传到后端
      const response = await axios.post(`${API_BASE}/admin/assets/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      console.log(`✅ 上传成功: ${response.data.assetId}\n`);
    } catch (error) {
      console.error(`❌ 上传失败: ${error}\n`);
    }
  }

  console.log('✅ 上传完成！');
}

uploadReports().catch(console.error);
