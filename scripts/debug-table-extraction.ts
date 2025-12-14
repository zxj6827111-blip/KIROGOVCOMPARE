/**
 * 调试表格提取过程
 * 显示 PDF 中的原始文本和表格提取的详细信息
 */

import * as path from 'path';
import * as pdfjs from 'pdfjs-dist';
import * as fs from 'fs';

async function debugTableExtraction() {
  const pdfPath = path.join(__dirname, '../fixtures/sample_pdfs_v1/上海市黄浦区人民政府2023年政府信息公开工作年度报告.pdf');
  
  console.log('📊 调试表格提取过程\n');
  console.log(`PDF 文件: ${pdfPath}\n`);

  try {
    const fileBuffer = fs.readFileSync(pdfPath);
    const uint8Array = new Uint8Array(fileBuffer);
    const pdf = await pdfjs.getDocument({ data: uint8Array }).promise;

    // 查找包含表格的页面
    console.log('🔍 查找表格所在的页面...\n');

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // 重构页面文本
      const pageText = reconstructPageText(textContent.items);
      
      // 检查是否包含表格关键字
      if (pageText.includes('第二十条第（一）项') || pageText.includes('信息内容')) {
        console.log(`✅ 第 ${pageNum} 页包含表格\n`);
        console.log('📄 页面文本内容:');
        console.log('─'.repeat(60));
        
        // 显示前 50 行
        const lines = pageText.split('\n');
        for (let i = 0; i < Math.min(50, lines.length); i++) {
          const line = lines[i];
          if (line.trim()) {
            console.log(`${i + 1}: ${line}`);
          }
        }
        
        if (lines.length > 50) {
          console.log(`... 还有 ${lines.length - 50} 行`);
        }
        
        console.log('─'.repeat(60));
        console.log();
        
        // 分析表格行
        console.log('📊 表格行分析:');
        console.log('─'.repeat(60));
        
        let inTable = false;
        let tableLineCount = 0;
        
        for (const line of lines) {
          const trimmed = line.trim();
          
          if (trimmed.includes('第二十条第（一）项')) {
            inTable = true;
            console.log(`表格开始: ${trimmed}`);
            continue;
          }
          
          if (inTable && trimmed) {
            // 检查是否是新的章节或表格
            if (/^[一二三四五六]、/.test(trimmed) || /^第/.test(trimmed)) {
              if (tableLineCount > 0) {
                console.log(`表格结束 (共 ${tableLineCount} 行)\n`);
                inTable = false;
              }
            }
            
            if (inTable) {
              tableLineCount++;
              const cells = trimmed.split(/\s+/);
              console.log(`行 ${tableLineCount}: ${cells.length} 个单元格 | ${trimmed.substring(0, 60)}${trimmed.length > 60 ? '...' : ''}`);
            }
          }
        }
        
        console.log('─'.repeat(60));
        break;
      }
    }

  } catch (error) {
    console.error('❌ 错误:', error);
  }
}

// 重构页面文本的方法
function reconstructPageText(items: any[]): string {
  if (items.length === 0) return '';

  // 简单方式：直接按顺序连接文本
  const lines: string[] = [];
  let currentLine = '';
  let lastY = -1;

  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    
    // 如果 Y 坐标变化较大，说明是新的一行
    if (lastY !== -1 && Math.abs(item.y - lastY) > 3) {
      if (currentLine.trim()) {
        lines.push(currentLine);
      }
      currentLine = item.str;
    } else {
      currentLine += item.str;
    }
    
    lastY = item.y;
  }

  if (currentLine.trim()) {
    lines.push(currentLine);
  }

  return lines.join('\n');
}

debugTableExtraction();
