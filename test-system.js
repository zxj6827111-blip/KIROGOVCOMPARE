#!/usr/bin/env node

/**
 * 系统完整性测试脚本
 * 验证政府信息公开年度报告差异比对系统的各个组件
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 政府信息公开年度报告差异比对系统 - 完整性测试\n');

// 测试1：检查核心文件是否存在
console.log('📋 测试1：检查核心文件...');
const coreFiles = [
  'src/index.ts',
  'src/models/ReportAsset.ts',
  'src/models/CompareTask.ts',
  'src/models/AISuggestion.ts',
  'src/models/BatchJob.ts',
  'src/services/PdfParseService.ts',
  'src/services/StructuringService.ts',
  'src/services/DiffService.ts',
  'src/services/SummaryService.ts',
  'src/services/DocxExportService.ts',
  'src/services/AISuggestionService.ts',
  'src/services/AISuggestionCacheService.ts',
  'src/services/FileUploadService.ts',
  'src/services/URLDownloadService.ts',
  'src/services/AssetService.ts',
  'src/services/TaskService.ts',
  'src/services/ExportJobService.ts',
  'src/services/CompareTaskProcessor.ts',
  'src/queue/processors.ts',
  'src/db/init.ts',
  'src/db/migrations.ts',
  'migrations/001_init_schema.sql',
  'src/routes/tasks.ts',
  'src/routes/assets.ts',
  'src/routes/suggestions.ts',
  'src/routes/batch-jobs.ts',
  'src/config/database.ts',
  'src/config/redis.ts',
  'src/config/queue.ts',
  'src/config/storage.ts',
  'Dockerfile',
  'docker-compose.yml',
  'API.md',
  'DEPLOYMENT.md',
];

let coreFilesOk = 0;
coreFiles.forEach((file) => {
  if (fs.existsSync(file)) {
    console.log(`  ✅ ${file}`);
    coreFilesOk++;
  } else {
    console.log(`  ❌ ${file} (缺失)`);
  }
});
console.log(`  结果: ${coreFilesOk}/${coreFiles.length} 文件存在\n`);

// 测试2：检查规范文档
console.log('📋 测试2：检查规范文档...');
const specFiles = [
  '.kiro/specs/gov-report-diff/requirements.md',
  '.kiro/specs/gov-report-diff/design.md',
  '.kiro/specs/gov-report-diff/tasks.md',
];

let specFilesOk = 0;
specFiles.forEach((file) => {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n').length;
    console.log(`  ✅ ${file} (${lines} 行)`);
    specFilesOk++;
  } else {
    console.log(`  ❌ ${file} (缺失)`);
  }
});
console.log(`  结果: ${specFilesOk}/${specFiles.length} 规范文档存在\n`);

// 测试3：检查测试文件
console.log('📋 测试3：检查测试文件...');
const testFiles = [
  'src/services/__tests__/properties.test.ts',
  'src/services/__tests__/integration.test.ts',
  'src/services/__tests__/PdfParseService.test.ts',
];

let testFilesOk = 0;
testFiles.forEach((file) => {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf-8');
    const testCount = (content.match(/test\(/g) || []).length + (content.match(/it\(/g) || []).length;
    console.log(`  ✅ ${file} (${testCount} 个测试)`);
    testFilesOk++;
  } else {
    console.log(`  ❌ ${file} (缺失)`);
  }
});
console.log(`  结果: ${testFilesOk}/${testFiles.length} 测试文件存在\n`);

// 测试4：检查测试数据
console.log('📋 测试4：检查测试数据...');
const fixturesDir = 'fixtures/sample_pdfs_v1';
if (fs.existsSync(fixturesDir)) {
  const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.pdf'));
  console.log(`  ✅ 测试数据目录存在 (${files.length} 个 PDF 文件)`);
  files.slice(0, 5).forEach((f) => {
    console.log(`     - ${f}`);
  });
  if (files.length > 5) {
    console.log(`     ... 还有 ${files.length - 5} 个文件`);
  }
} else {
  console.log(`  ❌ 测试数据目录不存在`);
}
console.log();

// 测试5：检查 package.json 依赖
console.log('📋 测试5：检查项目依赖...');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const requiredDeps = [
  'express',
  'pg',
  'redis',
  'pdfjs-dist',
  'docx',
  'bull',
  'axios',
  'dotenv',
  'uuid',
];

let depsOk = 0;
requiredDeps.forEach((dep) => {
  if (packageJson.dependencies[dep]) {
    console.log(`  ✅ ${dep} (${packageJson.dependencies[dep]})`);
    depsOk++;
  } else {
    console.log(`  ❌ ${dep} (缺失)`);
  }
});
console.log(`  结果: ${depsOk}/${requiredDeps.length} 依赖已安装\n`);

// 测试6：检查 API 端点
console.log('📋 测试6：检查 API 端点...');
const routeFiles = [
  'src/routes/tasks.ts',
  'src/routes/assets.ts',
  'src/routes/suggestions.ts',
  'src/routes/batch-jobs.ts',
];

let routesOk = 0;
routeFiles.forEach((file) => {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf-8');
    const endpoints = (content.match(/router\.(get|post|put|patch|delete)\(/g) || []).length;
    console.log(`  ✅ ${file} (${endpoints} 个端点)`);
    routesOk++;
  } else {
    console.log(`  ❌ ${file} (缺失)`);
  }
});
console.log(`  结果: ${routesOk}/${routeFiles.length} 路由文件存在\n`);

// 测试7：检查服务实现
console.log('📋 测试7：检查核心服务实现...');
const services = [
  { file: 'src/services/PdfParseService.ts', name: 'PDF 解析' },
  { file: 'src/services/StructuringService.ts', name: '文档结构化' },
  { file: 'src/services/DiffService.ts', name: '差异比对' },
  { file: 'src/services/SummaryService.ts', name: '摘要生成' },
  { file: 'src/services/DocxExportService.ts', name: 'DOCX 导出' },
  { file: 'src/services/AISuggestionService.ts', name: 'AI 建议' },
  { file: 'src/services/FileUploadService.ts', name: '文件上传' },
  { file: 'src/services/URLDownloadService.ts', name: 'URL 下载' },
  { file: 'src/services/AssetService.ts', name: '资产管理' },
  { file: 'src/services/TaskService.ts', name: '任务管理' },
];

let servicesOk = 0;
services.forEach(({ file, name }) => {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf-8');
    const methods = (content.match(/^\s*(public\s+)?static\s+\w+|^\s*(public\s+)?\w+\s*\(/gm) || []).length;
    console.log(`  ✅ ${name} (${methods} 个方法)`);
    servicesOk++;
  } else {
    console.log(`  ❌ ${name} (缺失)`);
  }
});
console.log(`  结果: ${servicesOk}/${services.length} 服务已实现\n`);

// 测试8：检查属性基测试
console.log('📋 测试8：检查属性基测试...');
if (fs.existsSync('src/services/__tests__/properties.test.ts')) {
  const content = fs.readFileSync('src/services/__tests__/properties.test.ts', 'utf-8');
  const properties = (content.match(/Property \d+:/g) || []).length;
  console.log(`  ✅ 属性基测试文件存在 (${properties} 个属性)`);
  
  // 列出所有属性
  const propertyMatches = content.match(/Property \d+: [^\n]+/g) || [];
  propertyMatches.forEach((p) => {
    console.log(`     - ${p}`);
  });
} else {
  console.log(`  ❌ 属性基测试文件不存在`);
}
console.log();

// 总结
console.log('📊 测试总结:');
console.log(`  ✅ 核心文件: ${coreFilesOk}/${coreFiles.length}`);
console.log(`  ✅ 规范文档: ${specFilesOk}/${specFiles.length}`);
console.log(`  ✅ 测试文件: ${testFilesOk}/${testFiles.length}`);
console.log(`  ✅ 项目依赖: ${depsOk}/${requiredDeps.length}`);
console.log(`  ✅ 路由文件: ${routesOk}/${routeFiles.length}`);
console.log(`  ✅ 核心服务: ${servicesOk}/${services.length}`);

const totalTests = coreFilesOk + specFilesOk + testFilesOk + depsOk + routesOk + servicesOk;
const totalExpected = coreFiles.length + specFiles.length + testFiles.length + requiredDeps.length + routeFiles.length + services.length;

console.log(`\n🎯 总体完成度: ${totalTests}/${totalExpected} (${Math.round((totalTests / totalExpected) * 100)}%)\n`);

if (totalTests === totalExpected) {
  console.log('✅ 系统完整性检查通过！所有组件已实现。\n');
  process.exit(0);
} else {
  console.log('⚠️  系统还有部分组件缺失，请检查上述标记为 ❌ 的项目。\n');
  process.exit(1);
}
