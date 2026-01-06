/**
 * Fix Garbled Chinese Encoding in Source Files (SAFE VERSION)
 * Safely replaces garbled text with correct Chinese, handling regex characters properly.
 * 
 * Usage: node scripts/fix-encoding-safe.js
 */

const fs = require('fs');
const path = require('path');

// Mapping of garbled Chinese → correct Chinese
// NOTE: These strings are carefully collected from the codebase
const GARBLED_TO_CORRECT = {
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
  '骞?鏍搁獙': '年校验', // Note: ? matches literal ? here because we escape it below
  '椤?': '项',          // Note: ? matches literal ? here because we escape it below
  '鑾峰彇绉熸埛鍒楄〃澶辫触': '获取租户列表失败',
  '鑾峰彇鐢ㄦ埛鍒楄〃澶辫触': '获取用户列表失败',
  '鐢ㄦ埛鍚嶆垨瀵嗙爜閿欒': '用户名或密码错误',
  '鍒涘缓鐢ㄦ埛鎴愬姛': '创建用户成功',
  '鐢ㄦ埛鍚嶅凡瀛樺湪': '用户名已存在',
  '鍒涘缓鐢ㄦ埛澶辫触': '创建用户失败',
  '鐢ㄦ埛淇敼鎴愬姛': '用户修改成功',
  '淇敼鐢ㄦ埛澶辫触': '修改用户失败',
  '涓嶈兘鍒犻櫎鑷繁': '不能删除自己',
  '鐢ㄦ埛鍒犻櫎鎴愬姛': '用户删除成功',
  '鍒犻櫎鐢ㄦ埛澶辫触': '删除用户失败'
  // Add more as needed
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

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

function fixFile(filePath) {
  const fullPath = path.resolve(__dirname, '..', filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`  - ${filePath}: not found, skipping`);
    return 0;
  }
  
  let content = fs.readFileSync(fullPath, 'utf8');
  let changeCount = 0;
  
  for (const [garbled, correct] of Object.entries(GARBLED_TO_CORRECT)) {
    // Critical: Escape regex characters!
    const escapedGarbled = escapeRegExp(garbled);
    const regex = new RegExp(escapedGarbled, 'g');
    
    if (regex.test(content)) {
      const matches = content.match(regex);
      content = content.replace(regex, correct);
      changeCount += matches ? matches.length : 0;
    }
  }
  
  if (changeCount > 0) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`  ✓ ${filePath}: ${changeCount} replacements`);
  } else {
    // console.log(`  - ${filePath}: no garbled text found`);
  }
  
  return changeCount;
}

console.log('🔧 Fixing Garbled Chinese Encoding (Safe Mode)...\n');

let totalChanges = 0;
for (const file of FILES_TO_FIX) {
  totalChanges += fixFile(file);
}

console.log(`\n✅ Done! Total replacements: ${totalChanges}`);
