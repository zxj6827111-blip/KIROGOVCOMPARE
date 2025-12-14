/**
 * 分析 PDF 文件的结构
 * 用于理解 sample_pdfs_v1 中 PDF 的具体内容和格式
 */

import * as fs from 'fs';
import * as path from 'path';
import * as pdfjs from 'pdfjs-dist';

async function analyzePDF(pdfPath: string) {
  console.log(`\n📄 分析 PDF: ${path.basename(pdfPath)}\n`);

  try {
    const fileBuffer = fs.readFileSync(pdfPath);
    const uint8Array = new Uint8Array(fileBuffer);
    const pdf = await pdfjs.getDocument({ data: uint8Array }).promise;

    console.log(`📊 基本信息:`);
    console.log(`   总页数: ${pdf.numPages}`);

    // 提取前 5 页的文本内容
    for (let pageNum = 1; pageNum <= Math.min(5, pdf.numPages); pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      console.log(`\n📖 第 ${pageNum} 页内容:`);
      console.log(`   文本项数: ${textContent.items.length}`);

      // 提取文本
      const pageText = textContent.items
        .filter((item: any) => item.str && item.str.trim())
        .map((item: any) => item.str)
        .join('');

      // 显示前 500 个字符
      const preview = pageText.substring(0, 500);
      console.log(`   内容预览: ${preview}...`);

      // 识别章节标题
      const lines = pageText.split('\n');
      const chapterLines = lines.filter(line => /^[一二三四五六]、/.test(line.trim()));
      if (chapterLines.length > 0) {
        console.log(`   识别到的章节标题:`);
        chapterLines.forEach(line => {
          console.log(`     - ${line.trim()}`);
        });
      }
    }

    // 统计所有页面中的章节标题
    console.log(`\n📋 全文章节统计:`);
    const allChapters = new Set<string>();
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .filter((item: any) => item.str && item.str.trim())
        .map((item: any) => item.str)
        .join('');

      const lines = pageText.split('\n');
      const chapterLines = lines.filter(line => /^[一二三四五六]、/.test(line.trim()));
      chapterLines.forEach(line => {
        allChapters.add(line.trim());
      });
    }

    if (allChapters.size > 0) {
      console.log(`   共识别到 ${allChapters.size} 个章节:`);
      Array.from(allChapters).forEach(chapter => {
        console.log(`     - ${chapter}`);
      });
    } else {
      console.log(`   未识别到标准章节标题`);
    }
  } catch (error) {
    console.error(`❌ 分析失败: ${error}`);
  }
}

// 分析第一个 PDF 文件
async function main() {
  const sampleDir = path.join(__dirname, '../fixtures/sample_pdfs_v1');
  const pdfFiles = fs.readdirSync(sampleDir).filter(f => f.endsWith('.pdf'));

  if (pdfFiles.length === 0) {
    console.log('❌ 没有找到 PDF 文件');
    return;
  }

  // 分析第一个文件
  const firstPdf = path.join(sampleDir, pdfFiles[0]);
  await analyzePDF(firstPdf);
}

main().catch(error => {
  console.error('错误:', error);
  process.exit(1);
});
