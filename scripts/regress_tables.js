#!/usr/bin/env node

/**
 * 表格提取回归测试脚本
 * 用于验证 Python 表格提取引擎的质量
 * 
 * 使用方式：
 *   node scripts/regress_tables.js
 * 
 * 输出：
 *   - 控制台：实时进度
 *   - test-sample-pdfs-report.json：详细报告
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SAMPLE_PDFS_DIR = path.join(__dirname, '../sample_pdfs_v1');
const SCHEMA_PATH = path.join(__dirname, '../src/schemas/annual_report_table_schema_v2.json');
const REPORT_PATH = path.join(__dirname, '../test-sample-pdfs-report.json');
const PY_SCRIPT = path.join(__dirname, '../python/extract_tables_pdfplumber.py');

/**
 * 运行 Python 表格提取
 */
function runPythonExtraction(pdfPath, timeoutMs = 180000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const pythonProcess = spawn('python3', [
      PY_SCRIPT,
      pdfPath,
      '--schema',
      SCHEMA_PATH,
      '--out',
      '-',
    ]);

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      console.error(`  ⏱️  超时 (${timeoutMs}ms)，正在杀死进程...`);
      pythonProcess.kill('SIGKILL');
    }, timeoutMs);

    pythonProcess.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      clearTimeout(timeoutHandle);
      const elapsedMs = Date.now() - startTime;

      if (timedOut) {
        return resolve({
          success: false,
          error: `进程超时 (${timeoutMs}ms)`,
          elapsedMs,
        });
      }

      if (code !== 0) {
        return resolve({
          success: false,
          error: `进程异常退出 (code=${code}): ${stderr}`,
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
          error: `JSON 解析失败: ${parseError.message}`,
          elapsedMs,
        });
      }
    });

    pythonProcess.on('error', (err) => {
      clearTimeout(timeoutHandle);
      const elapsedMs = Date.now() - startTime;
      resolve({
        success: false,
        error: `进程启动失败: ${err.message}`,
        elapsedMs,
      });
    });
  });
}

/**
 * 分析表格质量
 */
function analyzeTableQuality(result) {
  const tables = result.tables || {};
  const analysis = {
    totalTables: Object.keys(tables).length,
    tables: {},
    summary: {
      avgConfidence: 0,
      avgNonEmptyCellRate: 0,
      avgRowMatchRate: 0,
      completeCount: 0,
      partialCount: 0,
      failedCount: 0,
    },
  };

  let totalConfidence = 0;
  let totalNonEmptyRate = 0;
  let totalRowMatchRate = 0;

  for (const [tableId, table] of Object.entries(tables)) {
    const metrics = table.metrics || {};
    const completeness = table.completeness || 'unknown';

    analysis.tables[tableId] = {
      title: table.title || tableId,
      completeness,
      metrics: {
        nonEmptyCells: metrics.nonEmptyCells || 0,
        totalCells: metrics.totalCells || 0,
        nonEmptyRatio: (metrics.nonEmptyRatio || 0).toFixed(2),
        matchedRows: metrics.matchedRows || 0,
        expectedRows: metrics.expectedRows || 0,
        rowMatchRate: (metrics.rowMatchRate || 0).toFixed(2),
        numericParseRate: (metrics.numericParseRate || 0).toFixed(2),
      },
      confidence: (table.confidence || 0).toFixed(2),
      issues: table.issues || [],
    };

    totalConfidence += table.confidence || 0;
    totalNonEmptyRate += metrics.nonEmptyRatio || 0;
    totalRowMatchRate += metrics.rowMatchRate || 0;

    if (completeness === 'complete') {
      analysis.summary.completeCount++;
    } else if (completeness === 'partial') {
      analysis.summary.partialCount++;
    } else {
      analysis.summary.failedCount++;
    }
  }

  const tableCount = Object.keys(tables).length;
  if (tableCount > 0) {
    analysis.summary.avgConfidence = (totalConfidence / tableCount).toFixed(2);
    analysis.summary.avgNonEmptyCellRate = (totalNonEmptyRate / tableCount).toFixed(2);
    analysis.summary.avgRowMatchRate = (totalRowMatchRate / tableCount).toFixed(2);
  }

  return analysis;
}

/**
 * 主函数
 */
async function main() {
  console.log('📊 表格提取回归测试');
  console.log(`📁 样例目录: ${SAMPLE_PDFS_DIR}`);
  console.log(`📋 Schema: ${SCHEMA_PATH}`);
  console.log('');

  // 检查目录和文件
  if (!fs.existsSync(SAMPLE_PDFS_DIR)) {
    console.error(`❌ 样例目录不存在: ${SAMPLE_PDFS_DIR}`);
    process.exit(1);
  }

  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error(`❌ Schema 文件不存在: ${SCHEMA_PATH}`);
    process.exit(1);
  }

  if (!fs.existsSync(PY_SCRIPT)) {
    console.error(`❌ Python 脚本不存在: ${PY_SCRIPT}`);
    process.exit(1);
  }

  // 获取样例 PDF 列表
  const pdfFiles = fs.readdirSync(SAMPLE_PDFS_DIR)
    .filter(f => f.endsWith('.pdf'))
    .map(f => path.join(SAMPLE_PDFS_DIR, f));

  if (pdfFiles.length === 0) {
    console.warn(`⚠️  样例目录中没有 PDF 文件`);
    console.log(`请将至少 3 份样例 PDF 放入: ${SAMPLE_PDFS_DIR}`);
    process.exit(1);
  }

  console.log(`✓ 找到 ${pdfFiles.length} 份样例 PDF\n`);

  // 运行测试
  const report = {
    timestamp: new Date().toISOString(),
    sampleCount: pdfFiles.length,
    results: [],
    summary: {
      totalPdfs: pdfFiles.length,
      successCount: 0,
      failureCount: 0,
      avgElapsedMs: 0,
    },
  };

  let totalElapsedMs = 0;

  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfPath = pdfFiles[i];
    const pdfName = path.basename(pdfPath);

    console.log(`[${i + 1}/${pdfFiles.length}] 处理: ${pdfName}`);

    const pyResult = await runPythonExtraction(pdfPath);

    if (pyResult.success) {
      console.log(`  ✓ 成功 (${pyResult.elapsedMs}ms)`);
      const analysis = analyzeTableQuality(pyResult.result);
      console.log(`  📊 ${analysis.totalTables} 张表: ${analysis.summary.completeCount} 完整, ${analysis.summary.partialCount} 部分, ${analysis.summary.failedCount} 失败`);
      console.log(`  📈 平均置信度: ${analysis.summary.avgConfidence}`);

      report.results.push({
        pdfName,
        status: 'success',
        elapsedMs: pyResult.elapsedMs,
        analysis,
      });

      report.summary.successCount++;
      totalElapsedMs += pyResult.elapsedMs;
    } else {
      console.log(`  ❌ 失败: ${pyResult.error}`);
      report.results.push({
        pdfName,
        status: 'failure',
        error: pyResult.error,
        elapsedMs: pyResult.elapsedMs,
      });

      report.summary.failureCount++;
    }

    console.log('');
  }

  // 计算平均耗时
  if (report.summary.successCount > 0) {
    report.summary.avgElapsedMs = Math.round(totalElapsedMs / report.summary.successCount);
  }

  // 输出报告
  console.log('📋 测试完成');
  console.log(`  ✓ 成功: ${report.summary.successCount}/${report.summary.totalPdfs}`);
  console.log(`  ❌ 失败: ${report.summary.failureCount}/${report.summary.totalPdfs}`);
  console.log(`  ⏱️  平均耗时: ${report.summary.avgElapsedMs}ms`);
  console.log(`\n📄 详细报告: ${REPORT_PATH}`);

  // 保存报告
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');

  // 如果有失败，退出码为 1
  process.exit(report.summary.failureCount > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('❌ 脚本异常:', error);
  process.exit(1);
});
