/**
 * 测试坐标提取修复
 * 验证 item.transform 是否被正确使用
 */

import * as fs from 'fs';
import * as path from 'path';
import * as pdfjs from 'pdfjs-dist';

async function testCoordinateExtraction() {
  console.log('🧪 开始测试坐标提取修复...\n');

  // 查找示例 PDF 文件
  const fixturesDir = path.join(__dirname, '../fixtures/sample_pdfs_v1');
  const pdfFiles = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.pdf'));

  if (pdfFiles.length === 0) {
    console.error('❌ 未找到示例 PDF 文件');
    return;
  }

  const pdfFile = pdfFiles[0];
  const pdfPath = path.join(fixturesDir, pdfFile);

  console.log(`📄 测试文件: ${pdfFile}`);
  console.log(`📍 路径: ${pdfPath}\n`);

  try {
    // 读取 PDF
    const fileBuffer = fs.readFileSync(pdfPath);
    const uint8Array = new Uint8Array(fileBuffer);
    const pdf = await pdfjs.getDocument({ data: uint8Array }).promise;

    console.log(`📊 PDF 页数: ${pdf.numPages}\n`);

    // 测试第一页
    const page = await pdf.getPage(1);
    const textContent = await page.getTextContent();

    console.log('📋 第一页文本项分析:\n');
    console.log('项目 | 文本 | x | y | width | height | transform');
    console.log('-----|------|-------|-------|--------|--------|----------');

    let itemsWithCoords = 0;
    let itemsWithTransform = 0;
    let itemsWithoutCoords = 0;

    for (let i = 0; i < Math.min(10, textContent.items.length); i++) {
      const item: any = textContent.items[i];

      if (!item.str || !item.str.trim()) continue;

      const text = item.str.substring(0, 10).padEnd(10);
      const x = item.x !== undefined ? (item.x as number).toFixed(2) : 'undefined';
      const y = item.y !== undefined ? (item.y as number).toFixed(2) : 'undefined';
      const width = item.width !== undefined ? (item.width as number).toFixed(2) : 'undefined';
      const height = item.height !== undefined ? (item.height as number).toFixed(2) : 'undefined';
      const transform = item.transform ? `[${(item.transform as number[]).map((v: number) => v.toFixed(2)).join(',')}]` : 'undefined';

      console.log(`${i + 1} | ${text} | ${x} | ${y} | ${width} | ${height} | ${transform}`);

      // 统计
      if (item.x !== undefined && item.y !== undefined) {
        itemsWithCoords++;
      }
      if (item.transform) {
        itemsWithTransform++;
      }
      if (item.x === undefined && item.y === undefined) {
        itemsWithoutCoords++;
      }
    }

    console.log('\n📊 统计结果:');
    console.log(`  - 有 x/y 坐标的项: ${itemsWithCoords}`);
    console.log(`  - 有 transform 的项: ${itemsWithTransform}`);
    console.log(`  - 没有坐标的项: ${itemsWithoutCoords}`);

    // 分析 transform 字段
    console.log('\n🔍 Transform 字段分析:');
    const transformExamples: any[] = textContent.items
      .filter((item: any) => item.transform && item.str && item.str.trim())
      .slice(0, 5);

    for (const item of transformExamples) {
      const transform: number[] = item.transform;
      console.log(`  文本: "${item.str}"`);
      console.log(`    transform: [${transform.map(v => v.toFixed(2)).join(', ')}]`);
      console.log(`    x (transform[4]): ${transform[4]?.toFixed(2)}`);
      console.log(`    y (transform[5]): ${transform[5]?.toFixed(2)}`);
      console.log(`    item.x: ${item.x?.toFixed(2)}, item.y: ${item.y?.toFixed(2)}`);
      console.log('');
    }

    console.log('✅ 坐标提取测试完成');
  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

testCoordinateExtraction();
