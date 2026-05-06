/**
 * Fix Garbled Chinese Encoding in Source Files (SAFE VERSION)
 * Safely replaces garbled text with correct Chinese, handling regex characters properly.
 * 
 * Usage: node scripts/fix-encoding-safe.js
 */

const fs = require('fs');
const path = require('path');

// Mapping of garbled Chinese -> correct Chinese.
// Garbled keys are stored as base64 so this source file does not reintroduce mojibake.
const fromUtf8Base64 = (encoded) => Buffer.from(encoded, 'base64').toString('utf8');
const GARBLED_TO_CORRECT = new Map([
  [fromUtf8Base64('6Y+I54Wh6Y2m5p2/5bCv'), '未知地区'],
  [fromUtf8Base64('6ZG+5bOw5b2H5aej5pa/6Y2Y5ZeX5b225r626L6r6Kem'), '获取比对历史失败'],
  [fromUtf8Base64('57yC5ZOE55qv6LmH5ZGw6Y2Z5YKb5pqf'), '缺少必要参数'],
  [fromUtf8Base64('5aej5pa/55KB5p2/57aN6Y2S5raY57yT6Y605oSs5aeb'), '比对记录创建成功'],
  [fromUtf8Base64('6Y2S5raY57yT5aej5pa/5r626L6r6Kem'), '创建比对失败'],
  [fromUtf8Base64('6Y+D54qz5r2I6ZeE5oSv6ZeC6Y2m5p2/5bCv'), '无权限访问该地区'],
  [fromUtf8Base64('6ZG+5bOw5b2H5aej5pa/57yB5pK054GJ5r626L6r6Kem'), '获取比对结果失败'],
  [fromUtf8Base64('6aqeP+aguOmqjA=='), '年校验'],
  [fromUtf8Base64('5qSkPw=='), '项'],
  [fromUtf8Base64('6ZCi44Sm5Z+b6Y2a5baG5Z6o54C15ZeZ54ic6Za/5qyS7oek'), '用户名或密码错误'],
  [fromUtf8Base64('6ZCi44Sm5Z+b5reH7oa95pW86Y605oSs5aeb'), '用户修改成功'],
  [fromUtf8Base64('5reH7oa95pW86ZCi44Sm5Z+b5r626L6r6Kem'), '修改用户失败'],
  [fromUtf8Base64('5raT5baI5YWY6Y2S54q75quO6ZG37oGE57mB'), '不能删除自己'],
]);

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
  
  for (const [garbled, correct] of GARBLED_TO_CORRECT.entries()) {
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
