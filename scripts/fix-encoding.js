/**
 * Fix Garbled Chinese Encoding in Source Files
 * CODEX wrote files with incorrect encoding, causing Chinese text to display as garbled characters.
 * 
 * Usage: node scripts/fix-encoding.js
 */

const fs = require('fs');
const path = require('path');

// Mapping of garbled Chinese → correct Chinese
const GARBLED_TO_CORRECT = {
  // Common phrases
  '鏈煡鍦板尯': '未知地区',
  '鑾峰彇姣斿鍘嗗彶澶辫触': '获取比对历史失败',
  '缂哄皯蹇呰鍙傛暟': '缺少必要参数',
  '鍒涘缓澶辫触': '创建失败',
  '姣斿璁板綍鍒涘缓鎴愬姛': '比对记录创建成功',
  '鍒涘缓姣斿澶辫触': '创建比对失败',
  '鏃犳晥鐨勬瘮瀵笽D': '无效的比对ID',
  '鏃犳潈闄愯闂鍦板尯': '无权限访问该地区',
  '鑾峰彇姣斿缁撴灉澶辫触': '获取比对结果失败',
  '鍒犻櫎鎴愬姛': '删除成功',
  '鍒犻櫎澶辫触': '删除失败',
  '瀵煎嚭澶辫触': '导出失败',
  '鑾峰彇瀵煎嚭璁板綍澶辫触': '获取导出记录失败',
  '寮傚父': '异常',
  '姝ｅ父': '正常',
  '骞?鏍搁獙': '年校验',
  '椤?': '项',
  // Add more mappings as discovered
};

const FILES_TO_FIX = [
  'src/routes/comparison-history.ts',
  'src/routes/llm-comparisons.ts',
  'src/routes/jobs.ts',
  'src/routes/pdf-jobs.ts',
  'src/routes/pdf-export.ts',
  'src/routes/reports.ts',
  'src/routes/users.ts',
  'src/routes/notifications.ts',
  'src/services/PdfExportService.ts',
];

function fixFile(filePath) {
  const fullPath = path.resolve(__dirname, '..', filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`  - ${filePath}: not found, skipping`);
    return 0;
  }
  
  let content = fs.readFileSync(fullPath, 'utf8');
  let changeCount = 0;
  
  for (const [garbled, correct] of Object.entries(GARBLED_TO_CORRECT)) {
    const regex = new RegExp(garbled, 'g');
    const matches = content.match(regex);
    if (matches) {
      content = content.replace(regex, correct);
      changeCount += matches.length;
    }
  }
  
  if (changeCount > 0) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`  ✓ ${filePath}: ${changeCount} replacements`);
  } else {
    console.log(`  - ${filePath}: no garbled text found`);
  }
  
  return changeCount;
}

console.log('🔧 Fixing Garbled Chinese Encoding...\n');

let totalChanges = 0;
for (const file of FILES_TO_FIX) {
  totalChanges += fixFile(file);
}

console.log(`\n✅ Done! Total replacements: ${totalChanges}`);
console.log('\n📝 Note: Run "npm run build" after fixing to apply changes.');
