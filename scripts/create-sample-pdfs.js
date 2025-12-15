#!/usr/bin/env node

/**
 * 创建样例 PDF 文件（用于回归测试）
 * 
 * 使用方式：
 *   node scripts/create-sample-pdfs.js
 * 
 * 输出：
 *   - sample_pdfs_v1/sample_report_1.pdf
 *   - sample_pdfs_v1/sample_report_2.pdf
 *   - sample_pdfs_v1/sample_report_3.pdf
 * 
 * 注意：此脚本创建的是简单的文本 PDF，用于测试 Python 表格提取脚本
 * 实际的样例 PDF 应该从真实的政府报告中获取
 */

const fs = require('fs');
const path = require('path');

const SAMPLE_DIR = path.join(__dirname, '../sample_pdfs_v1');

// 确保目录存在
if (!fs.existsSync(SAMPLE_DIR)) {
  fs.mkdirSync(SAMPLE_DIR, { recursive: true });
}

/**
 * 创建简单的 PDF 文件（使用 PDF 原始格式）
 * 这是一个最小化的 PDF，包含基本的文本和表格结构
 */
function createSimplePdf(filename, year, region) {
  const filepath = path.join(SAMPLE_DIR, filename);

  // 最小化的 PDF 内容
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources 4 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
4 0 obj
<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>
endobj
5 0 obj
<< /Length 1200 >>
stream
BT
/F1 20 Tf
100 750 Td
(政府信息公开年度报告) Tj
0 -30 Td
/F1 12 Tf
(${year} 年 ${region}) Tj
0 -50 Td
/F1 14 Tf
(一、概述) Tj
0 -20 Td
/F1 11 Tf
(本报告根据《中华人民共和国政府信息公开条例》要求，由${region}编制。) Tj
0 -15 Td
(本年度共主动公开政府信息 1000 条，收到政府信息公开申请 50 件。) Tj
0 -40 Td
/F1 14 Tf
(二、主动公开政府信息情况) Tj
0 -20 Td
/F1 11 Tf
(信息类别 数量 占比) Tj
0 -15 Td
(政策文件 300 30%) Tj
0 -15 Td
(规划计划 200 20%) Tj
0 -15 Td
(财政资金 250 25%) Tj
0 -15 Td
(人事信息 150 15%) Tj
0 -15 Td
(其他信息 100 10%) Tj
0 -40 Td
/F1 14 Tf
(三、收到和处理政府信息公开申请情况) Tj
0 -20 Td
/F1 11 Tf
(申请类型 数量 处理时间) Tj
0 -15 Td
(当面申请 10 5天) Tj
0 -15 Td
(邮件申请 20 10天) Tj
0 -15 Td
(网络申请 15 7天) Tj
0 -15 Td
(其他方式 5 3天) Tj
0 -40 Td
/F1 14 Tf
(四、因政府信息公开工作被申请行政复议、提起行政诉讼情况) Tj
0 -20 Td
/F1 11 Tf
(事项 数量 结果) Tj
0 -15 Td
(行政复议 2 维持) Tj
0 -15 Td
(行政诉讼 1 驳回) Tj
0 -15 Td
(其他纠纷 0 -) Tj
0 -40 Td
/F1 14 Tf
(五、政府信息公开工作存在的主要问题及改进情况) Tj
0 -20 Td
/F1 11 Tf
(主要问题：1. 部分信息公开不够及时；2. 公开形式需要进一步完善。) Tj
0 -15 Td
(改进措施：1. 建立更完善的信息公开制度；2. 加强工作人员培训。) Tj
0 -40 Td
/F1 14 Tf
(六、其他需要报告的事项) Tj
0 -20 Td
/F1 11 Tf
(本年度继续加强政府信息公开工作，提高公开质量和效率。) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000214 00000 n 
0000000313 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
1563
%%EOF`;

  fs.writeFileSync(filepath, pdfContent, 'utf-8');
  console.log(`✓ 创建: ${filename}`);
}

/**
 * 主函数
 */
function main() {
  console.log('📄 创建样例 PDF 文件');
  console.log(`📁 输出目录: ${SAMPLE_DIR}\n`);

  try {
    createSimplePdf('sample_report_2023_beijing.pdf', 2023, '北京市');
    createSimplePdf('sample_report_2023_shanghai.pdf', 2023, '上海市');
    createSimplePdf('sample_report_2023_guangzhou.pdf', 2023, '广州市');

    console.log('\n✓ 样例 PDF 创建完成');
    console.log('现在可以运行: node scripts/regress_tables.js');
  } catch (error) {
    console.error('❌ 创建失败:', error);
    process.exit(1);
  }
}

main();
