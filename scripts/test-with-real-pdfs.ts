#!/usr/bin/env ts-node

/**
 * 使用真实 PDF 进行端到端测试
 * 测试 PDF 解析、表格提取、数据识别等完整流程
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const FIXTURES_DIR = path.join(__dirname, '../fixtures/sample_pdfs_v1');
const SCHEMA_PATH = path.join(__dirname, '../src/schemas/annual_report_table_schema_v2.json');
const PY_SCRIPT = path.join(__dirname, '../python/extract_tables_pdfplumber_v2.py');

interface TestResult {
  pdfName: string;
  pdfPath: string;
  fileSize: number;
  success: boolean;
  elapsedMs: number;
  tableCount: number;
  nonEmptyCells: number;
  confidence: number;
  completeness: string;
  issues: string[];
  error?: string;
}

/**
 * 获取真实 PDF 列表
 */
function getRealPdfs(): string[] {
  if (!fs.existsSync(FIXTURES_DIR)) {
    console.error(`❌ 目录不存在: ${FIXTURES_DIR}`);
    return [];
  }

  const files = fs.readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.pdf'))
    .map(f => path.join(FIXTURES_DIR, f));

  return files;
}

/**
 * 运行 Python 表格提取
 */
function runPythonExtraction(pdfPath: string): Promise<any> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    const pythonProcess = spawn('python3', [
      PY_SCRIPT,
      pdfPath,
      '--schema',
      SCHEMA_PATH,
      '--out',
      '-',
    ]);

    pythonProcess.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      const elapsedMs = Date.now() - startTime;

      if (code !== 0) {
        return resolve({
          success: false,
          error: stderr || `exit code ${code}`,
          elapsedMs,
        });
      }

      try {
        const result = JSON.parse(stdout);
        return resolve({
          success: true,
          result,
          elapsedMs,
        });
      } catch (parseError) {
        return resolve({
          success: false,
          error: `JSON 解析失败: ${parseError}`,
          elapsedMs,
        });
      }
    });

    pythonProcess.on('error', (err) => {
      const elapsedMs = Date.now() - startTime;
      resolve({
        success: false,
        error: err.message,
        elapsedMs,
      });
    });
  });
}

/**
 * 分析提取结果
 */
function analyzeResult(pyResult: any): any {
  const tables = pyResult.result?.tables || [];
  
  let totalNonEmptyCells = 0;
  let totalCells = 0;
  let avgConfidence = 0;
  let completeCount = 0;
  let partialCount = 0;
  let failedCount = 0;

  for (const table of tables) {
    const metrics = table.metrics || {};
    totalNonEmptyCells += metrics.nonEmptyCells || 0;
    totalCells += metrics.totalCells || 0;
    avgConfidence += table.confidence || 0;

    const completeness = table.completeness || 'failed';
    if (completeness === 'complete') {
      completeCount++;
    } else if (completeness === 'partial') {
      partialCount++;
    } else {
      failedCount++;
    }
  }

  if (tables.length > 0) {
    avgConfidence = avgConfidence / tables.length;
  }

  return {
    tableCount: tables.length,
    nonEmptyCells: totalNonEmptyCells,
    totalCells,
    nonEmptyCellRate: totalCells > 0 ? (totalNonEmptyCells / totalCells).toFixed(2) : '0.00',
    avgConfidence: avgConfidence.toFixed(2),
    completeCount,
    partialCount,
    failedCount,
    issues: pyResult.result?.issues || [],
  };
}

/**
 * 主函数
 */
async function main() {
  console.log('🧪 使用真实 PDF 进行端到端测试');
  console.log('='.repeat(60));

  // 获取真实 PDF 列表
  const pdfFiles = getRealPdfs();
  
  if (pdfFiles.length === 0) {
    console.error('❌ 未找到 PDF 文件');
    process.exit(1);
  }

  console.log(`\n📁 找到 ${pdfFiles.length} 份真实 PDF 文件\n`);

  const results: TestResult[] = [];
  let successCount = 0;
  let failureCount = 0;

  // 测试每个 PDF
  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfPath = pdfFiles[i];
    const pdfName = path.basename(pdfPath);
    const fileSize = fs.statSync(pdfPath).size;

    console.log(`[${i + 1}/${pdfFiles.length}] 处理: ${pdfName} (${(fileSize / 1024).toFixed(1)}KB)`);

    const pyResult = await runPythonExtraction(pdfPath);

    if (pyResult.success) {
      const analysis = analyzeResult(pyResult);
      
      console.log(`  ✅ 成功 (${pyResult.elapsedMs}ms)`);
      console.log(`  📊 ${analysis.tableCount} 张表: ${analysis.completeCount} 完整, ${analysis.partialCount} 部分, ${analysis.failedCount} 失败`);
      console.log(`  📈 非空单元格: ${analysis.nonEmptyCells}/${analysis.totalCells} (${analysis.nonEmptyCellRate})`);
      console.log(`  📈 平均置信度: ${analysis.avgConfidence}`);

      if (analysis.issues.length > 0) {
        console.log(`  ⚠️  问题: ${analysis.issues.slice(0, 2).join(', ')}`);
      }

      results.push({
        pdfName,
        pdfPath,
        fileSize,
        success: true,
        elapsedMs: pyResult.elapsedMs,
        tableCount: analysis.tableCount,
        nonEmptyCells: analysis.nonEmptyCells,
        confidence: parseFloat(analysis.avgConfidence),
        completeness: analysis.completeCount > 0 ? 'complete' : (analysis.partialCount > 0 ? 'partial' : 'failed'),
        issues: analysis.issues,
      });

      successCount++;
    } else {
      console.log(`  ❌ 失败: ${pyResult.error}`);

      results.push({
        pdfName,
        pdfPath,
        fileSize,
        success: false,
        elapsedMs: pyResult.elapsedMs,
        tableCount: 0,
        nonEmptyCells: 0,
        confidence: 0,
        completeness: 'failed',
        issues: [],
        error: pyResult.error,
      });

      failureCount++;
    }

    console.log('');
  }

  // 输出总结
  console.log('='.repeat(60));
  console.log('📊 测试结果总结:');
  console.log(`  ✅ 成功: ${successCount}/${pdfFiles.length}`);
  console.log(`  ❌ 失败: ${failureCount}/${pdfFiles.length}`);

  // 统计数据
  const successResults = results.filter(r => r.success);
  if (successResults.length > 0) {
    const avgElapsedMs = Math.round(
      successResults.reduce((sum, r) => sum + r.elapsedMs, 0) / successResults.length
    );
    const totalTables = successResults.reduce((sum, r) => sum + r.tableCount, 0);
    const totalNonEmptyCells = successResults.reduce((sum, r) => sum + r.nonEmptyCells, 0);
    const avgConfidence = (
      successResults.reduce((sum, r) => sum + r.confidence, 0) / successResults.length
    ).toFixed(2);

    console.log(`\n📈 统计数据:`);
    console.log(`  ⏱️  平均耗时: ${avgElapsedMs}ms`);
    console.log(`  📊 总表格数: ${totalTables}`);
    console.log(`  📊 总非空单元格: ${totalNonEmptyCells}`);
    console.log(`  📈 平均置信度: ${avgConfidence}`);
  }

  // 保存详细报告
  const reportPath = path.join(__dirname, '../test-real-pdfs-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalPdfs: pdfFiles.length,
    successCount,
    failureCount,
    results,
  }, null, 2), 'utf-8');

  console.log(`\n📄 详细报告: ${reportPath}`);

  // 显示前 3 个成功的 PDF 的详细信息
  console.log('\n📋 成功提取的 PDF 详情:');
  successResults.slice(0, 3).forEach((result, idx) => {
    console.log(`\n  ${idx + 1}. ${result.pdfName}`);
    console.log(`     - 文件大小: ${(result.fileSize / 1024).toFixed(1)}KB`);
    console.log(`     - 表格数: ${result.tableCount}`);
    console.log(`     - 非空单元格: ${result.nonEmptyCells}`);
    console.log(`     - 置信度: ${result.confidence.toFixed(2)}`);
    console.log(`     - 完整性: ${result.completeness}`);
  });

  process.exit(failureCount > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('❌ 测试异常:', error);
  process.exit(1);
});
