/**
 * 调试 operatorList 的操作码
 */

import * as fs from 'fs';
import * as path from 'path';
import * as pdfjs from 'pdfjs-dist';

async function debugOperatorList() {
  console.log('🔍 调试 operatorList...\n');

  try {
    const fixturesDir = path.join(__dirname, '../fixtures/sample_pdfs_v1');
    const pdfFiles = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      console.error('❌ 未找到示例 PDF 文件');
      return;
    }

    const pdfFile = pdfFiles[0];
    const pdfPath = path.join(fixturesDir, pdfFile);

    const fileBuffer = fs.readFileSync(pdfPath);
    const uint8Array = new Uint8Array(fileBuffer);
    const pdf = await pdfjs.getDocument({ data: uint8Array }).promise;

    const page = await pdf.getPage(2);
    const operatorList = await page.getOperatorList();

    console.log('📋 操作列表详情:\n');
    console.log(`fnArray 长度: ${operatorList.fnArray.length}`);
    console.log(`argsArray 长度: ${operatorList.argsArray.length}\n`);

    // 显示前 50 个操作
    console.log('前 50 个操作:');
    for (let i = 0; i < Math.min(50, operatorList.fnArray.length); i++) {
      const fn = operatorList.fnArray[i];
      const args = operatorList.argsArray[i];
      
      let fnName = String(fn);
      // 尝试识别常见操作
      const opNames: any = {
        1: 'moveTo',
        2: 'lineTo',
        3: 'curveTo',
        4: 'closePath',
        5: 'rectangle',
        9: 'fill',
        10: 'stroke',
        11: 'fillStroke',
        12: 'eoFill',
        28: 'setFont',
        30: 'showText',
        31: 'showSpacedText',
        32: 'nextLine',
        37: 'setFillColor',
        41: 'setLineWidth',
        42: 'setLineCap',
        44: 'setLineJoin',
        58: 'setGState',
        59: 'save',
        91: 'restore',
      };
      
      if (opNames[fn]) {
        fnName = `${fn} (${opNames[fn]})`;
      }
      
      const argsStr = args ? `[${args.slice(0, 6).map((a: any) => typeof a === 'number' ? a.toFixed(2) : a).join(', ')}${args.length > 6 ? '...' : ''}]` : '[]';
      console.log(`  ${i + 1}. fn=${fnName}, args=${argsStr}`);
    }

    console.log('\n✅ 调试完成');
  } catch (error) {
    console.error('❌ 调试失败:', error);
  }
}

debugOperatorList();
