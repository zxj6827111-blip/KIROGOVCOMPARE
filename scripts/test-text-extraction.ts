/**
 * 测试纯文本表格提取（Stage B）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as pdfjs from 'pdfjs-dist';
import AdvancedTableExtractor from '../src/services/AdvancedTableExtractor';

async function testTextExtraction() {
  console.log('🧪 开始测试纯文本表格提取...\n');

  try {
    const fixturesDir = path.join(__dirname, '../fixtures/sample_pdfs_v1');
    const pdfFiles = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      console.error('❌ 未找到示例 PDF 文件');
      return;
    }

    const pdfFile = pdfFiles[0];
    const pdfPath = path.join(fixturesDir, pdfFile);

    console.log(`📄 测试文件: ${pdfFile}\n`);

    const fileBuffer = fs.readFileSync(pdfPath);
    const uint8Array = new Uint8Array(fileBuffer);
    const pdf = await pdfjs.getDocument({ data: uint8Array }).promise;

    // 测试第二页（通常包含表格）
    const pageNum = 2;
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    console.log(`📊 第 ${pageNum} 页分析:\n`);

    // 统计有坐标的文本项
    const itemsWithCoords = textContent.items.filter((item: any) => {
      if (!item.str || !item.str.trim()) return false;
      if (item.transform && Array.isArray(item.transform) && item.transform.length >= 6) {
        return true;
      }
      return false;
    });

    console.log(`📋 文本项统计:`);
    console.log(`  - 总项数: ${textContent.items.length}`);
    console.log(`  - 有坐标的项: ${itemsWithCoords.length}`);
    console.log(`  - 有效率: ${((itemsWithCoords.length / textContent.items.length) * 100).toFixed(1)}%\n`);

    // 测试纯文本提取
    console.log('🔍 测试纯文本提取...');
    const extractor = AdvancedTableExtractor as any;
    
    // 按 Y 坐标聚类
    const lines = extractor.clusterTextByY(itemsWithCoords);
    console.log(`✅ 聚类成 ${lines.length} 行\n`);

    // 显示前 5 行的内容
    console.log('📝 前 5 行内容:');
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = lines[i];
      const texts = line.map((item: any) => item.str).join(' | ');
      console.log(`  行 ${i + 1}: ${texts.substring(0, 80)}`);
    }
    console.log('');

    // 推断列边界
    console.log('🎯 推断列边界...');
    const expectedColCount = 7; // 假设 7 列
    const colBoundaries = extractor.inferColumnBoundaries(lines, expectedColCount);
    console.log(`✅ 推断出 ${colBoundaries.length - 1} 列\n`);

    console.log(`📐 列边界: ${(colBoundaries as number[]).map((x: number) => x.toFixed(2)).join(', ')}\n`);

    // 分配到单元格
    console.log('📍 分配到单元格...');
    const cells = extractor.assignTextToCells(lines, colBoundaries);
    console.log(`✅ 分配了 ${cells.length} 个单元格\n`);

    // 显示单元格内容
    console.log('📊 单元格内容 (前 20 个):');
    for (let i = 0; i < Math.min(20, cells.length); i++) {
      const cell = cells[i];
      console.log(`  [${cell.rowIndex}, ${cell.colIndex}]: ${cell.content.substring(0, 40)}`);
    }

    console.log('\n✅ 纯文本提取测试完成');
  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

testTextExtraction();
