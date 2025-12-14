#!/usr/bin/env node

/**
 * 表格解析回归测试脚本
 * 用于验证 Python pdfplumber 表格提取引擎的输出质量
 * 
 * 使用方式：
 *   node scripts/regress_tables.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// 配置
const SAMPLE_PDFS_DIR = path.join(__dirname, '../sample_pdfs_v1');
const SCHEMA_PATH = path.join(__dirname, '../src/schemas/annual_report_table_schema_v2.json');
const OUTPUT_DIR = path.join(__dirname, '../output');
const PY_SCRIPT = path.join(__dirname, '../python/extract_tables_pdfplumber.py');

// 确保输出目录存在
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * 获取样例 PDF 列表
 */
function getSamplePdfs() {
  if (!fs.existsSync(SAMPLE_PDFS_DIR)) {
    console.warn(`⚠ 样例 PDF 目录不存在: ${SAMPLE_PDFS_DIR}`);
    return [];
  }

  return fs.readdirSync(SAMPLE_PDFS_DIR)
    .filter(file => file.endsWith('.pdf'))
    .map(file => path.join(SAMPLE_PDFS_DIR, file));
}

/**
 * 运行 Python 表格提取脚本
 */
function extractTables(pdfPath) {
  try {
    const output = execFileSync('python3', [
      PY_SCRIPT,
      pdfPath,
      '--schema', SCHEMA_PATH,
      '--out', '-'
    ], {
      encoding: 'utf-8',
      timeout: 180000, // 3 分钟超时
    });

    return JSON.parse(output);
  } catch (error) {
    console.error(`✗ 提取失败 (${path.basename(pdfPath)}):`, error.message);
    return null;
  }
}

/**
 * 生成表格摘要
 */
function generateTableSummary(tableId, tableData) {
  const metrics = tableData.metrics || {};
  const completeness = tableData.completeness || 'unknown';
  const confidence = tableData.confidence || 0;
  const issues = (tableData.issues || []).slice(0, 3); // 前 3 条问题

  return {
    tableId,
    completeness,
    confidence: confidence.toFixed(2),
    nonEmptyCells: metrics.nonEmptyCells || 0,
    totalCells: metrics.totalCells || 0,
    nonEmptyRatio: (metrics.nonEmptyRatio || 0).toFixed(4),
    matchedRows: metrics.matchedRows || 0,
    expectedRows: metrics.expectedRows || 0,
    rowMatchRate: (metrics.rowMatchRate || 0).toFixed(4),
    numericParseRate: (metrics.numericParseRate || 0).toFixed(4),
    issues: issues.length > 0 ? issues : ['无'],
  };
}

/**
 * 打印表格摘要（控制台表格格式）
 */
function printTableSummary(pdfName, summaries) {
  console.log(`\n📄 ${pdfName}`);
  console.log('─'.repeat(120));

  const headers = [
    '表格 ID',
    '完整性',
    '置信度',
    '非空单元格',
    '总单元格',
    '非空比例',
    '匹配行',
    '预期行',
    '行匹配率',
    '数值解析率',
  ];

  console.log(
    headers.map(h => h.padEnd(15)).join('│')
  );
  console.log('─'.repeat(120));

  summaries.forEach(summary => {
    const row = [
      summary.tableId.padEnd(15),
      summary.completeness.padEnd(15),
      summary.confidence.padEnd(15),
      String(summary.nonEmptyCells).padEnd(15),
      String(summary.totalCells).padEnd(15),
      summary.nonEmptyRatio.padEnd(15),
      String(summary.matchedRows).padEnd(15),
      String(summary.expectedRows).padEnd(15),
      summary.rowMatchRate.padEnd(15),
      summary.numericParseRate.padEnd(15),
    ];
    console.log(row.join('│'));

    if (summary.issues.length > 0 && summary.issues[0] !== '无') {
      console.log(`  ⚠ 问题: ${summary.issues.join('; ')}`);
    }
  });
}

/**
 * 主函数
 */
async function main() {
  console.log('🔍 表格解析回归测试');
  console.log('═'.repeat(120));

  const pdfFiles = getSamplePdfs();
  if (pdfFiles.length === 0) {
    console.error('✗ 未找到样例 PDF 文件');
    process.exit(1);
  }

  console.log(`✓ 找到 ${pdfFiles.length} 份样例 PDF\n`);

  const allResults = [];
  let successCount = 0;

  for (const pdfPath of pdfFiles) {
    const pdfName = path.basename(pdfPath);
    process.stdout.write(`处理中: ${pdfName}... `);

    const result = extractTables(pdfPath);
    if (!result) {
      console.log('✗ 失败');
      continue;
    }

    console.log('✓ 成功');
    successCount++;

    // 生成摘要
    const tables = result.tables || {};
    const summaries = Object.entries(tables).map(([tableId, tableData]) =>
      generateTableSummary(tableId, tableData)
    );

    // 打印摘要
    printTableSummary(pdfName, summaries);

    // 保存完整结果
    allResults.push({
      pdfName,
      timestamp: new Date().toISOString(),
      result,
      summaries,
    });
  }

  // 保存汇总报告
  const summaryPath = path.join(OUTPUT_DIR, 'regress_tables_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalPdfs: pdfFiles.length,
    successCount,
    failureCount: pdfFiles.length - successCount,
    results: allResults,
  }, null, 2));

  console.log('\n' + '═'.repeat(120));
  console.log(`✓ 回归测试完成: ${successCount}/${pdfFiles.length} 成功`);
  console.log(`✓ 汇总报告已保存: ${summaryPath}`);
}

main().catch(error => {
  console.error('✗ 回归测试失败:', error);
  process.exit(1);
});
