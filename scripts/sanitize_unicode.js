#!/usr/bin/env node

/**
 * 清理文件中的隐藏 Unicode 字符
 * 包括: 零宽字符、双向文本控制字符、BOM 等
 */

const fs = require('fs');
const path = require('path');

// 需要清理的隐藏 Unicode 字符正则表达式
const HIDDEN_UNICODE_REGEX = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

function sanitizeFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const cleaned = content.replace(HIDDEN_UNICODE_REGEX, '');
    
    if (content !== cleaned) {
      fs.writeFileSync(filePath, cleaned, 'utf8');
      console.log(`✅ 已清理: ${filePath}`);
      return true;
    } else {
      console.log(`⏭️  无需清理: ${filePath}`);
      return false;
    }
  } catch (err) {
    console.error(`❌ 处理失败 ${filePath}:`, err.message);
    return false;
  }
}

function scanDirectory(dir, extensions = ['.ts', '.js', '.sh', '.sql', '.json']) {
  let cleanedCount = 0;
  
  function scan(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        // 跳过 node_modules 和隐藏目录
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }
        scan(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          if (sanitizeFile(fullPath)) {
            cleanedCount++;
          }
        }
      }
    }
  }
  
  scan(dir);
  return cleanedCount;
}

// 主函数
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('用法: node sanitize_unicode.js <文件或目录路径>');
    console.log('示例: node sanitize_unicode.js src/');
    process.exit(1);
  }
  
  const targetPath = path.resolve(args[0]);
  
  if (!fs.existsSync(targetPath)) {
    console.error(`❌ 路径不存在: ${targetPath}`);
    process.exit(1);
  }
  
  const stat = fs.statSync(targetPath);
  let cleanedCount = 0;
  
  if (stat.isDirectory()) {
    console.log(`🔍 扫描目录: ${targetPath}`);
    cleanedCount = scanDirectory(targetPath);
  } else {
    console.log(`🔍 处理文件: ${targetPath}`);
    cleanedCount = sanitizeFile(targetPath) ? 1 : 0;
  }
  
  console.log(`\n✨ 完成！清理了 ${cleanedCount} 个文件`);
}

main();
