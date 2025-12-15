#!/usr/bin/env node

/**
 * 回归测试脚本 - Python v3 表格提取引擎
 * 
 * 用法：
 *   node scripts/regress_tables_v3.js
 * 
 * 功能：
 * 1. 遍历 sample_pdfs_v1/ 目录下的所有 PDF
 * 2. 调用 python/extract_tables_pdfplumber_v3.py 提取表格
 * 3. 计算每张表的指标（nonEmptyCells、matchedRows、numericParseRate、confidence）
 * 4. 检查是否达到阈值
 * 5. 生成测试报告
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 配置
const SAMPLE_PDFS_DIR = path.join(__dirname, '../sample_pdfs_v1');
const SCHEMA_PATH = path.join(__dirname, '../src/schemas/annual_report_table_schema_v2.json');
const PYTHON_SCRIPT = path.join(__dirname, '../python/extract_tables_pdfplumber_v3.py');
const OUTPUT_REPORT = path.join(__dirname, '../test-regress-v3-report.json');

// 验收阈值
const THRESHOLDS = {
  matchedRows: 0.90,           // matchedRows / expectedRows >= 90%
  numericParseRate: 0.95,      // 数值解析率 >= 95%
  confidence: 0.75,            // 置信度 >= 75%
};

// 不允许的 issues
const FORBIDDEN_ISSUES = [
  'page_not_found',
  'table_not_found',
  'no_text',
];

class RegressionTester {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      totalPdfs: 0,
      passedPdfs: 0,
      failedPdfs: 0,
      pdfs: [],
      summary: {
        totalTables: 0,
        passedTables: 0,
        failedTables: 0,
        avgConfidence: 0,
        avgMatchedRows: 0,
        avgNumericParseRate: 0,
      },
      thresholds: THRESHOLDS,
    };
  }

  /**
   * 获取 sample_pdfs_v1 目录下的所有 PDF 文件
   */
  getPdfFiles() {
    if (!fs.existsSync(SAMPLE_PDFS_DIR)) {
      console.error(`❌ 目录不存在: ${SAMPLE_PDFS_DIR}`);
      process.exit(1);
    }

    const files = fs.readdirSync(SAMPLE_PDFS_DIR);
    const pdfFiles = files
      .filter(f => f.endsWith('.pdf'))
      .map(f => path.join(SAMPLE_PDFS_DIR, f));

    if (pdfFiles.length === 0) {
      console.error(`❌ 没有找到 PDF 文件在 ${SAMPLE_PDFS_DIR}`);
      process.exit(1);
    }

    console.log(`✓ 找到 ${pdfFiles.length} 个 PDF 文件`);
    return pdfFiles;
  }

  /**
   * 检查依赖
   */
  checkDependencies() {
    // 检查 Python 脚本
    if (!fs.existsSync(PYTHON_SCRIPT)) {
      console.error(`❌ Python 脚本不存在: ${PYTHON_SCRIPT}`);
      process.exit(1);
    }

    // 检查 schema
    if (!fs.existsSync(SCHEMA_PATH)) {
      console.error(`❌ Schema 文件不存在: ${SCHEMA_PATH}`);
      process.exit(1);
    }

    console.log('✓ 依赖检查通过');
  }

  /**
   * 运行 Python 脚本提取表格
   */
  extractTables(pdfPath) {
    try {
      const cmd = `python3 "${PYTHON_SCRIPT}" "${pdfPath}" --schema "${SCHEMA_PATH}" --out -`;
      const output = execSync(cmd, { encoding: 'utf-8' });
      return JSON.parse(output);
    } catch (error) {
      console.error(`❌ 提取表格失败 (${path.basename(pdfPath)}):`, error.message);
      return null;
    }
  }

  /**
   * 检查表格是否通过验收
   */
  checkTablePass(table) {
    const metrics = table.metrics || {};
    const issues = table.issues || [];

    // 检查禁止的 issues
    const hasForbiddenIssues = issues.some(issue => 
      FORBIDDEN_ISSUES.some(forbidden => issue.includes(forbidden))
    );

    if (hasForbiddenIssues) {
      return {
        pass: false,
        reason: `包含禁止的 issues: ${issues.join(', ')}`,
      };
    }

    // 检查 matchedRows 阈值
    const expectedRows = metrics.expectedRows || 0;
    const matchedRows = metrics.matchedRows || 0;
    const matchedRowsRate = expectedRows > 0 ? matchedRows / expectedRows : 0;

    if (matchedRowsRate < THRESHOLDS.matchedRows) {
      return {
        pass: false,
        reason: `matchedRows 不达标: ${(matchedRowsRate * 100).toFixed(1)}% < ${(THRESHOLDS.matchedRows * 100).toFixed(1)}%`,
      };
    }

    // 检查 numericParseRate 阈值
    const numericParseRate = metrics.numericParseRate || 0;
    if (numericParseRate < THRESHOLDS.numericParseRate) {
      return {
        pass: false,
        reason: `numericParseRate 不达标: ${(numericParseRate * 100).toFixed(1)}% < ${(THRESHOLDS.numericParseRate * 100).toFixed(1)}%`,
      };
    }

    // 检查 confidence 阈值
    const confidence = metrics.confidence || 0;
    if (confidence < THRESHOLDS.confidence) {
      return {
        pass: false,
        reason: `confidence 不达标: ${(confidence * 100).toFixed(1)}% < ${(THRESHOLDS.confidence * 100).toFixed(1)}%`,
      };
    }

    return {
      pass: true,
      reason: '所有指标达标',
    };
  }

  /**
   * 处理单个 PDF
   */
  processPdf(pdfPath) {
    const pdfName = path.basename(pdfPath);
    console.log(`\n📄 处理: ${pdfName}`);

    // 提取表格
    const result = this.extractTables(pdfPath);
    if (!result) {
      return {
        pdfName,
        pdfPath,
        success: false,
        error: '提取表格失败',
        tables: [],
      };
    }

    // 检查每个表格
    const tables = result.tables || [];
    const pdfResult = {
      pdfName,
      pdfPath,
      success: true,
      tableCount: tables.length,
      tables: [],
      passedTables: 0,
      failedTables: 0,
    };

    for (const table of tables) {
      const check = this.checkTablePass(table);
      const tableResult = {
        id: table.id,
        section: table.section,
        metrics: table.metrics,
        confidence: table.confidence,
        issues: table.issues,
        pass: check.pass,
        reason: check.reason,
      };

      pdfResult.tables.push(tableResult);

      if (check.pass) {
        pdfResult.passedTables++;
        console.log(`  ✓ 表格 ${table.id}: ${check.reason}`);
      } else {
        pdfResult.failedTables++;
        console.log(`  ✗ 表格 ${table.id}: ${check.reason}`);
      }
    }

    return pdfResult;
  }

  /**
   * 运行所有测试
   */
  run() {
    console.log('🚀 开始回归测试 (Python v3 表格提取引擎)\n');

    // 检查依赖
    this.checkDependencies();

    // 获取 PDF 文件
    const pdfFiles = this.getPdfFiles();
    this.results.totalPdfs = pdfFiles.length;

    // 处理每个 PDF
    for (const pdfPath of pdfFiles) {
      const pdfResult = this.processPdf(pdfPath);
      this.results.pdfs.push(pdfResult);

      if (pdfResult.success && pdfResult.failedTables === 0) {
        this.results.passedPdfs++;
      } else {
        this.results.failedPdfs++;
      }

      // 累计表格统计
      for (const table of pdfResult.tables) {
        this.results.summary.totalTables++;
        if (table.pass) {
          this.results.summary.passedTables++;
        } else {
          this.results.summary.failedTables++;
        }

        // 累计指标
        const metrics = table.metrics || {};
        this.results.summary.avgConfidence += table.confidence || 0;
        this.results.summary.avgMatchedRows += (metrics.matchedRows || 0) / (metrics.expectedRows || 1);
        this.results.summary.avgNumericParseRate += metrics.numericParseRate || 0;
      }
    }

    // 计算平均值
    if (this.results.summary.totalTables > 0) {
      this.results.summary.avgConfidence /= this.results.summary.totalTables;
      this.results.summary.avgMatchedRows /= this.results.summary.totalTables;
      this.results.summary.avgNumericParseRate /= this.results.summary.totalTables;
    }

    // 输出报告
    this.printReport();
    this.saveReport();

    // 返回退出码
    return this.results.failedPdfs === 0 ? 0 : 1;
  }

  /**
   * 打印报告
   */
  printReport() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 回归测试报告');
    console.log('='.repeat(60));

    console.log(`\n总体统计：`);
    console.log(`  总 PDF 数: ${this.results.totalPdfs}`);
    console.log(`  通过 PDF: ${this.results.passedPdfs} ✓`);
    console.log(`  失败 PDF: ${this.results.failedPdfs} ✗`);

    console.log(`\n表格统计：`);
    console.log(`  总表格数: ${this.results.summary.totalTables}`);
    console.log(`  通过表格: ${this.results.summary.passedTables} ✓`);
    console.log(`  失败表格: ${this.results.summary.failedTables} ✗`);

    console.log(`\n平均指标：`);
    console.log(`  平均置信度: ${(this.results.summary.avgConfidence * 100).toFixed(1)}%`);
    console.log(`  平均行匹配率: ${(this.results.summary.avgMatchedRows * 100).toFixed(1)}%`);
    console.log(`  平均数值解析率: ${(this.results.summary.avgNumericParseRate * 100).toFixed(1)}%`);

    console.log(`\n验收阈值：`);
    console.log(`  matchedRows >= ${(THRESHOLDS.matchedRows * 100).toFixed(1)}%`);
    console.log(`  numericParseRate >= ${(THRESHOLDS.numericParseRate * 100).toFixed(1)}%`);
    console.log(`  confidence >= ${(THRESHOLDS.confidence * 100).toFixed(1)}%`);

    console.log('\n' + '='.repeat(60));

    if (this.results.failedPdfs === 0) {
      console.log('✅ 所有测试通过！');
    } else {
      console.log(`❌ 有 ${this.results.failedPdfs} 个 PDF 未通过测试`);
    }

    console.log('='.repeat(60));
  }

  /**
   * 保存报告
   */
  saveReport() {
    fs.writeFileSync(OUTPUT_REPORT, JSON.stringify(this.results, null, 2), 'utf-8');
    console.log(`\n📄 报告已保存: ${OUTPUT_REPORT}`);
  }
}

// 运行测试
const tester = new RegressionTester();
const exitCode = tester.run();
process.exit(exitCode);
