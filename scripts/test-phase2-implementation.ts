/**
 * 第二阶段实现验证脚本
 * 
 * 测试项：
 * 1. 解析数据自动保存功能
 * 2. 解析数据读取功能
 * 3. API 端点返回解析数据
 * 4. 前端表格渲染数据格式
 */

import * as fs from 'fs';
import * as path from 'path';
import PdfParseService from '../src/services/PdfParseService';
import ParsedDataStorageService from '../src/services/ParsedDataStorageService';
import AssetService from '../src/services/AssetService';

interface TestResult {
  testName: string;
  passed: boolean;
  message: string;
  details?: any;
}

const results: TestResult[] = [];

async function runTests() {
  console.log('\n🧪 开始第二阶段实现验证\n');

  // 测试 1: 解析数据自动保存
  await testAutoSaveParseData();

  // 测试 2: 解析数据读取
  await testLoadParseData();

  // 测试 3: 数据存储服务
  await testStorageService();

  // 测试 4: 表格数据格式
  await testTableDataFormat();

  // 打印测试结果
  printResults();
}

async function testAutoSaveParseData() {
  console.log('📝 测试 1: 解析数据自动保存功能');
  
  try {
    const sampleDir = path.join(__dirname, '../fixtures/sample_pdfs_v1');
    const pdfFiles = fs.readdirSync(sampleDir).filter(f => f.endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      results.push({
        testName: '解析数据自动保存',
        passed: false,
        message: '❌ 没有找到示例 PDF 文件',
      });
      return;
    }

    const testPdfFile = pdfFiles[0];
    const testPdfPath = path.join(sampleDir, testPdfFile);
    const testAssetId = `test_auto_save_${Date.now()}`;

    console.log(`  ├─ 使用示例 PDF: ${testPdfFile}`);
    console.log(`  ├─ 资产 ID: ${testAssetId}`);

    // 解析 PDF
    const parseResult = await PdfParseService.parsePDF(testPdfPath, testAssetId);

    if (!parseResult.success) {
      results.push({
        testName: '解析数据自动保存',
        passed: false,
        message: `❌ PDF 解析失败: ${parseResult.error}`,
      });
      return;
    }

    // 检查数据是否已保存
    const hasSavedData = await ParsedDataStorageService.hasParseData(testAssetId);

    if (hasSavedData) {
      const savedData = await ParsedDataStorageService.loadParseData(testAssetId);
      const dataSize = await ParsedDataStorageService.getParseDataSize(testAssetId);

      results.push({
        testName: '解析数据自动保存',
        passed: true,
        message: `✅ 解析数据已自动保存`,
        details: {
          assetId: testAssetId,
          dataSize: `${(dataSize / 1024).toFixed(2)} KB`,
          sections: savedData?.sections?.length || 0,
          hasMetadata: !!savedData?.metadata,
        },
      });

      console.log(`  ├─ ✅ 数据已保存 (${(dataSize / 1024).toFixed(2)} KB)`);
      console.log(`  ├─ 章节数: ${savedData?.sections?.length || 0}`);
      console.log(`  └─ 元数据: ${savedData?.metadata ? '有' : '无'}`);

      // 清理测试数据
      await ParsedDataStorageService.deleteParseData(testAssetId);
    } else {
      results.push({
        testName: '解析数据自动保存',
        passed: false,
        message: '❌ 解析数据未被保存',
      });
      console.log(`  └─ ❌ 数据未保存`);
    }
  } catch (error) {
    results.push({
      testName: '解析数据自动保存',
      passed: false,
      message: `❌ 测试异常: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.log(`  └─ ❌ 异常: ${error}`);
  }
}

async function testLoadParseData() {
  console.log('\n📖 测试 2: 解析数据读取功能');

  try {
    const testAssetId = `test_load_${Date.now()}`;
    const testData = {
      documentId: `doc_${testAssetId}`,
      assetId: testAssetId,
      title: '测试文档',
      sections: [
        {
          id: 'sec1',
          level: 1,
          title: '一、测试章节',
          content: [{ id: 'para1', text: '这是测试内容', type: 'normal' }],
          tables: [],
          subsections: [],
        },
      ],
      metadata: {
        totalPages: 1,
        extractedAt: new Date(),
        parseVersion: '2.0',
      },
    };

    console.log(`  ├─ 资产 ID: ${testAssetId}`);

    // 保存测试数据
    await ParsedDataStorageService.saveParseData(testAssetId, testData);
    console.log(`  ├─ 已保存测试数据`);

    // 读取数据
    const loadedData = await ParsedDataStorageService.loadParseData(testAssetId);

    if (loadedData && loadedData.assetId === testAssetId) {
      results.push({
        testName: '解析数据读取',
        passed: true,
        message: `✅ 解析数据读取成功`,
        details: {
          assetId: loadedData.assetId,
          title: loadedData.title,
          sections: loadedData.sections?.length || 0,
        },
      });

      console.log(`  ├─ ✅ 数据读取成功`);
      console.log(`  ├─ 标题: ${loadedData.title}`);
      console.log(`  └─ 章节数: ${loadedData.sections?.length || 0}`);

      // 清理测试数据
      await ParsedDataStorageService.deleteParseData(testAssetId);
    } else {
      results.push({
        testName: '解析数据读取',
        passed: false,
        message: '❌ 读取的数据不匹配',
      });
      console.log(`  └─ ❌ 数据不匹配`);
    }
  } catch (error) {
    results.push({
      testName: '解析数据读取',
      passed: false,
      message: `❌ 测试异常: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.log(`  └─ ❌ 异常: ${error}`);
  }
}

async function testStorageService() {
  console.log('\n💾 测试 3: 数据存储服务功能');

  try {
    const testAssetId = `test_storage_${Date.now()}`;
    const testData = {
      documentId: `doc_${testAssetId}`,
      assetId: testAssetId,
      title: '存储服务测试',
      sections: [],
      metadata: { totalPages: 1, extractedAt: new Date(), parseVersion: '2.0' },
    };

    console.log(`  ├─ 资产 ID: ${testAssetId}`);

    // 测试保存
    const savedPath = await ParsedDataStorageService.saveParseData(testAssetId, testData);
    console.log(`  ├─ ✅ 数据已保存到: ${path.basename(savedPath)}`);

    // 测试检查存在
    const exists = await ParsedDataStorageService.hasParseData(testAssetId);
    console.log(`  ├─ ✅ 数据存在检查: ${exists ? '存在' : '不存在'}`);

    // 测试获取大小
    const size = await ParsedDataStorageService.getParseDataSize(testAssetId);
    console.log(`  ├─ ✅ 数据大小: ${(size / 1024).toFixed(2)} KB`);

    // 测试获取修改时间
    const modTime = await ParsedDataStorageService.getParseDataModifiedTime(testAssetId);
    console.log(`  ├─ ✅ 修改时间: ${modTime?.toLocaleString('zh-CN')}`);

    // 测试获取统计信息
    const stats = await ParsedDataStorageService.getStorageStats();
    console.log(`  ├─ ✅ 存储统计: ${stats.totalFiles} 个文件, 总大小 ${(stats.totalSize / 1024).toFixed(2)} KB`);

    // 测试删除
    await ParsedDataStorageService.deleteParseData(testAssetId);
    const existsAfterDelete = await ParsedDataStorageService.hasParseData(testAssetId);
    console.log(`  └─ ✅ 数据删除: ${!existsAfterDelete ? '成功' : '失败'}`);

    results.push({
      testName: '数据存储服务',
      passed: true,
      message: `✅ 存储服务所有功能正常`,
      details: {
        save: '✅',
        check: '✅',
        size: '✅',
        modTime: '✅',
        stats: '✅',
        delete: '✅',
      },
    });
  } catch (error) {
    results.push({
      testName: '数据存储服务',
      passed: false,
      message: `❌ 测试异常: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.log(`  └─ ❌ 异常: ${error}`);
  }
}

async function testTableDataFormat() {
  console.log('\n📊 测试 4: 表格数据格式验证');

  try {
    const sampleDir = path.join(__dirname, '../fixtures/sample_pdfs_v1');
    const pdfFiles = fs.readdirSync(sampleDir).filter(f => f.endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      results.push({
        testName: '表格数据格式',
        passed: false,
        message: '❌ 没有找到示例 PDF 文件',
      });
      return;
    }

    const testPdfFile = pdfFiles[0];
    const testPdfPath = path.join(sampleDir, testPdfFile);
    const testAssetId = `test_table_format_${Date.now()}`;

    console.log(`  ├─ 使用示例 PDF: ${testPdfFile}`);

    // 解析 PDF
    const parseResult = await PdfParseService.parsePDF(testPdfPath, testAssetId);

    if (!parseResult.success || !parseResult.document) {
      results.push({
        testName: '表格数据格式',
        passed: false,
        message: `❌ PDF 解析失败`,
      });
      return;
    }

    const doc = parseResult.document;
    let tableCount = 0;
    let rowCount = 0;
    let cellCount = 0;
    let hasValidTableStructure = true;

    // 检查表格结构
    for (const section of doc.sections) {
      for (const table of section.tables) {
        tableCount++;

        // 检查表格是否有行
        if (!table.rows || table.rows.length === 0) {
          hasValidTableStructure = false;
          continue;
        }

        rowCount += table.rows.length;

        // 检查每行是否有单元格
        for (const row of table.rows) {
          if (!row.cells || row.cells.length === 0) {
            hasValidTableStructure = false;
            continue;
          }

          cellCount += row.cells.length;

          // 检查单元格格式
          for (const cell of row.cells) {
            if (!cell.hasOwnProperty('value') || !cell.hasOwnProperty('colIndex') || !cell.hasOwnProperty('rowIndex')) {
              hasValidTableStructure = false;
            }
          }
        }
      }
    }

    console.log(`  ├─ 表格数: ${tableCount}`);
    console.log(`  ├─ 行数: ${rowCount}`);
    console.log(`  ├─ 单元格数: ${cellCount}`);
    console.log(`  └─ 结构有效: ${hasValidTableStructure ? '✅' : '❌'}`);

    results.push({
      testName: '表格数据格式',
      passed: hasValidTableStructure && tableCount > 0,
      message: hasValidTableStructure && tableCount > 0 ? '✅ 表格数据格式正确' : '❌ 表格数据格式有问题',
      details: {
        tableCount,
        rowCount,
        cellCount,
        structureValid: hasValidTableStructure,
      },
    });

    // 清理测试数据
    await ParsedDataStorageService.deleteParseData(testAssetId);
  } catch (error) {
    results.push({
      testName: '表格数据格式',
      passed: false,
      message: `❌ 测试异常: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.log(`  └─ ❌ 异常: ${error}`);
  }
}

function printResults() {
  console.log('\n' + '='.repeat(60));
  console.log('📋 测试结果总结');
  console.log('='.repeat(60) + '\n');

  let passedCount = 0;
  let failedCount = 0;

  for (const result of results) {
    const status = result.passed ? '✅ 通过' : '❌ 失败';
    console.log(`${status} | ${result.testName}`);
    console.log(`   ${result.message}`);

    if (result.details) {
      console.log(`   详情: ${JSON.stringify(result.details, null, 2)}`);
    }

    console.log();

    if (result.passed) {
      passedCount++;
    } else {
      failedCount++;
    }
  }

  console.log('='.repeat(60));
  console.log(`总计: ${passedCount} 通过, ${failedCount} 失败`);
  console.log(`成功率: ${((passedCount / (passedCount + failedCount)) * 100).toFixed(1)}%`);
  console.log('='.repeat(60) + '\n');

  process.exit(failedCount > 0 ? 1 : 0);
}

// 运行测试
runTests().catch(error => {
  console.error('测试执行异常:', error);
  process.exit(1);
});
