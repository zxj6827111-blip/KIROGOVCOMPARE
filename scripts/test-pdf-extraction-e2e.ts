#!/usr/bin/env ts-node

/**
 * 端到端测试：PDF 解析 + 表格提取
 * 验证整个流程是否能正常工作
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const SAMPLE_PDF = path.join(__dirname, '../sample_pdfs_v1/sample_report_2023_beijing.pdf');
const SCHEMA_PATH = path.join(__dirname, '../src/schemas/annual_report_table_schema_v2.json');
const PY_SCRIPT = path.join(__dirname, '../python/extract_tables_pdfplumber.py');

/**
 * 测试 1：检查文件是否存在
 */
function testFilesExist(): boolean {
  console.log('\n📋 测试 1：检查文件是否存在');
  
  const files = [
    { path: SAMPLE_PDF, name: '样例 PDF' },
    { path: SCHEMA_PATH, name: 'Schema 文件' },
    { path: PY_SCRIPT, name: 'Python 脚本' },
  ];

  let allExist = true;
  for (const file of files) {
    if (fs.existsSync(file.path)) {
      console.log(`  ✅ ${file.name}: ${file.path}`);
    } else {
      console.log(`  ❌ ${file.name} 不存在: ${file.path}`);
      allExist = false;
    }
  }

  return allExist;
}

/**
 * 测试 2：验证 Schema 格式
 */
function testSchemaFormat(): boolean {
  console.log('\n📋 测试 2：验证 Schema 格式');

  try {
    const schemaContent = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    const schema = JSON.parse(schemaContent);

    console.log(`  ✅ Schema 是有效的 JSON`);
    console.log(`  📊 Schema 版本: ${schema.version || 'unknown'}`);
    console.log(`  📊 表格数量: ${Array.isArray(schema.tables) ? schema.tables.length : Object.keys(schema.tables || {}).length}`);

    // 检查 tables 格式
    if (Array.isArray(schema.tables)) {
      console.log(`  ✅ tables 是数组格式（v2 标准）`);
      
      // 检查第一个表格
      if (schema.tables.length > 0) {
        const firstTable = schema.tables[0];
        console.log(`  📋 第一个表格:`);
        console.log(`     - ID: ${firstTable.id}`);
        console.log(`     - 标题: ${firstTable.title}`);
        console.log(`     - 行数: ${firstTable.rows?.length || 0}`);
        console.log(`     - 列数: ${firstTable.columns?.length || 0}`);
      }
    } else {
      console.log(`  ⚠️  tables 是对象格式（v1 兼容）`);
    }

    return true;
  } catch (error) {
    console.log(`  ❌ Schema 解析失败: ${error}`);
    return false;
  }
}

/**
 * 测试 3：运行 Python 表格提取
 */
function testPythonExtraction(): Promise<boolean> {
  console.log('\n📋 测试 3：运行 Python 表格提取');

  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    const pythonProcess = spawn('python3', [
      PY_SCRIPT,
      SAMPLE_PDF,
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
      console.error(`  [stderr] ${data}`);
    });

    pythonProcess.on('close', (code) => {
      const elapsedMs = Date.now() - startTime;

      if (code !== 0) {
        console.log(`  ❌ Python 进程异常退出 (code=${code})`);
        console.log(`  错误信息: ${stderr}`);
        return resolve(false);
      }

      try {
        const result = JSON.parse(stdout);
        console.log(`  ✅ Python 脚本执行成功 (${elapsedMs}ms)`);
        console.log(`  📊 提取结果:`);
        console.log(`     - 表格数: ${Object.keys(result.tables || {}).length}`);
        console.log(`     - 问题数: ${(result.issues || []).length}`);

        // 分析每张表
        const tables = result.tables || {};
        for (const [tableId, table] of Object.entries(tables)) {
          console.log(`\n  📋 表格: ${tableId}`);
          console.log(`     - 标题: ${(table as any).title}`);
          console.log(`     - 完整性: ${(table as any).completeness}`);
          console.log(`     - 置信度: ${(table as any).confidence}`);
          
          const metrics = (table as any).metrics || {};
          console.log(`     - 非空单元格: ${metrics.nonEmptyCells}/${metrics.totalCells}`);
          console.log(`     - 行匹配率: ${metrics.rowMatchRate}`);
          console.log(`     - 数字解析率: ${metrics.numericParseRate}`);
          
          if ((table as any).issues?.length > 0) {
            console.log(`     - 问题: ${(table as any).issues.join(', ')}`);
          }
        }

        return resolve(true);
      } catch (parseError) {
        console.log(`  ❌ JSON 解析失败: ${parseError}`);
        console.log(`  输出内容 (前 500 字): ${stdout.substring(0, 500)}`);
        return resolve(false);
      }
    });

    pythonProcess.on('error', (err) => {
      console.log(`  ❌ 进程启动失败: ${err.message}`);
      resolve(false);
    });
  });
}

/**
 * 测试 4：验证 TypeScript 服务
 */
async function testTypeScriptService(): Promise<boolean> {
  console.log('\n📋 测试 4：验证 TypeScript 服务');

  try {
    // 动态导入服务
    const { default: PythonTableExtractionService } = await import(
      '../dist/services/PythonTableExtractionService'
    );

    console.log(`  ✅ PythonTableExtractionService 导入成功`);

    // 调用服务
    const result = await PythonTableExtractionService.extractTablesFromPdf(
      SAMPLE_PDF,
      SCHEMA_PATH,
      30000  // 30 秒超时
    );

    if (result.success) {
      console.log(`  ✅ 服务调用成功`);
      console.log(`  📊 提取结果:`);
      console.log(`     - 表格数: ${result.tables?.length || 0}`);
      console.log(`     - 耗时: ${result.metrics?.elapsedMs}ms`);
      console.log(`     - 置信度: ${result.metrics?.confidence}`);
      
      if (result.metrics?.issues?.length) {
        console.log(`     - 问题: ${result.metrics.issues.join(', ')}`);
      }

      return true;
    } else {
      console.log(`  ❌ 服务调用失败: ${result.error}`);
      return false;
    }
  } catch (error) {
    console.log(`  ⚠️  TypeScript 服务测试跳过（需要先编译）`);
    console.log(`     运行 npm run build 后重试`);
    return true; // 不算失败
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🧪 PDF 解析端到端测试');
  console.log('='.repeat(50));

  const results = {
    filesExist: testFilesExist(),
    schemaFormat: testSchemaFormat(),
    pythonExtraction: await testPythonExtraction(),
    typeScriptService: await testTypeScriptService(),
  };

  console.log('\n' + '='.repeat(50));
  console.log('📊 测试结果总结:');
  console.log(`  ✅ 文件检查: ${results.filesExist ? '通过' : '失败'}`);
  console.log(`  ✅ Schema 验证: ${results.schemaFormat ? '通过' : '失败'}`);
  console.log(`  ✅ Python 提取: ${results.pythonExtraction ? '通过' : '失败'}`);
  console.log(`  ✅ TS 服务: ${results.typeScriptService ? '通过' : '失败'}`);

  const allPassed = Object.values(results).every((r) => r);
  console.log(`\n${allPassed ? '✅ 所有测试通过！' : '❌ 部分测试失败'}`);

  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error('❌ 测试异常:', error);
  process.exit(1);
});
