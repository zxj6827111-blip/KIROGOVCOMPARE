/**
 * 测试网格线提取和聚类
 */

import * as fs from 'fs';
import * as path from 'path';
import * as pdfjs from 'pdfjs-dist';
import AdvancedTableExtractor from '../src/services/AdvancedTableExtractor';

async function testGridExtraction() {
  console.log('🧪 开始测试网格线提取...\n');

  try {
    // 查找示例 PDF
    const fixturesDir = path.join(__dirname, '../fixtures/sample_pdfs_v1');
    const pdfFiles = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      console.error('❌ 未找到示例 PDF 文件');
      return;
    }

    const pdfFile = pdfFiles[0];
    const pdfPath = path.join(fixturesDir, pdfFile);

    console.log(`📄 测试文件: ${pdfFile}\n`);

    // 读取 PDF
    const fileBuffer = fs.readFileSync(pdfPath);
    const uint8Array = new Uint8Array(fileBuffer);
    const pdf = await pdfjs.getDocument({ data: uint8Array }).promise;

    // 测试第二页（通常包含表格）
    const pageNum = 2;
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const operatorList = await page.getOperatorList();

    console.log(`📊 第 ${pageNum} 页分析:\n`);

    // 分析 operatorList
    if (operatorList && operatorList.fnArray) {
      console.log(`📋 操作列表统计:`);
      const fnCounts = new Map<string, number>();
      for (const fn of operatorList.fnArray) {
        const fnStr = String(fn);
        fnCounts.set(fnStr, (fnCounts.get(fnStr) || 0) + 1);
      }

      for (const [fn, count] of fnCounts.entries()) {
        console.log(`  - ${fn}: ${count} 次`);
      }
      console.log('');
    }

    // 测试线段提取
    console.log('🔍 测试线段提取...');
    const extractor = AdvancedTableExtractor as any;
    const lines = extractor.extractLinesFromOperatorList(operatorList);
    
    console.log(`✅ 提取了 ${lines.length} 条线段\n`);

    if (lines.length > 0) {
      console.log('📐 线段样本 (前 10 条):');
      for (let i = 0; i < Math.min(10, lines.length); i++) {
        const line = lines[i];
        console.log(`  ${i + 1}. (${line.x1.toFixed(2)}, ${line.y1.toFixed(2)}) → (${line.x2.toFixed(2)}, ${line.y2.toFixed(2)}) [${line.isHorizontal ? '水平' : '竖直'}]`);
      }
      console.log('');

      // 测试聚类
      console.log('🎯 测试聚类...');
      const { rowBorders, colBorders } = extractor.clusterLines(lines);
      
      console.log(`✅ 聚类结果:`);
      console.log(`  - 行边界: ${rowBorders.length} 条 (${(rowBorders as number[]).map((y: number) => y.toFixed(2)).join(', ')})`);
      console.log(`  - 列边界: ${colBorders.length} 条 (${(colBorders as number[]).map((x: number) => x.toFixed(2)).join(', ')})`);
      console.log('');

      if (rowBorders.length > 0 && colBorders.length > 0) {
        console.log(`📊 表格结构: ${rowBorders.length - 1} 行 x ${colBorders.length - 1} 列\n`);

        // 测试文本投影
        console.log('📍 测试文本投影...');
        const cells = extractor.projectTextToCells(
          textContent.items,
          rowBorders,
          colBorders,
          {}
        );

        console.log(`✅ 投影了 ${cells.length} 个单元格\n`);

        if (cells.length > 0) {
          console.log('📝 单元格样本 (前 10 个):');
          for (let i = 0; i < Math.min(10, cells.length); i++) {
            const cell = cells[i];
            console.log(`  [${cell.rowIndex}, ${cell.colIndex}]: ${cell.content.substring(0, 30)}`);
          }
        }
      }
    }

    console.log('\n✅ 网格线提取测试完成');
  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

testGridExtraction();
