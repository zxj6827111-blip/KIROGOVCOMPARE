/**
 * 调试 PDF 内容提取
 */

import * as path from 'path';
import * as pdfjs from 'pdfjs-dist';
import * as fs from 'fs';

async function debugPdfContent() {
  const pdfPath = path.join(__dirname, '../fixtures/sample_pdfs_v1/上海市黄浦区人民政府2023年政府信息公开工作年度报告.pdf');
  
  console.log('📄 调试 PDF 内容提取\n');
  console.log(`PDF 文件: ${pdfPath}\n`);

  try {
    const fileBuffer = fs.readFileSync(pdfPath);
    const uint8Array = new Uint8Array(fileBuffer);
    const pdf = await pdfjs.getDocument({ data: uint8Array }).promise;

    console.log(`📊 PDF 信息:`);
    console.log(`   - 页数: ${pdf.numPages}\n`);

    // 提取前 3 页的文本
    for (let pageNum = 1; pageNum <= Math.min(3, pdf.numPages); pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      console.log(`\n📄 第 ${pageNum} 页的文本项:`);
      console.log(`   共 ${textContent.items.length} 个文本项\n`);

      // 显示前 20 个文本项
      for (let i = 0; i < Math.min(20, textContent.items.length); i++) {
        const item: any = textContent.items[i];
        if (item.str && item.str.trim()) {
          const x = item.x ? item.x.toFixed(1) : 'N/A';
          const y = item.y ? item.y.toFixed(1) : 'N/A';
          const h = item.height ? item.height.toFixed(1) : 'N/A';
          console.log(`   ${i + 1}. "${item.str}" (x=${x}, y=${y}, h=${h})`);
        }
      }

      if (textContent.items.length > 20) {
        console.log(`   ... 还有 ${textContent.items.length - 20} 个文本项`);
      }
    }

  } catch (error) {
    console.error('❌ 错误:', error);
  }
}

debugPdfContent();
