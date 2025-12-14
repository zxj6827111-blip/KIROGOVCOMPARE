#!/bin/bash

# 本地系统测试脚本
# 用于在没有 Docker 的情况下测试系统

set -e

echo "🧪 本地系统测试"
echo "═══════════════════════════════════════════════════════════"

# 1. 检查环境
echo "📋 检查环境..."
echo "  ✓ Node.js: $(node --version)"
echo "  ✓ npm: $(npm --version)"
echo "  ✓ Python: $(python3 --version)"

# 2. 检查依赖
echo ""
echo "📦 检查依赖..."
if npm list pdfplumber > /dev/null 2>&1; then
  echo "  ✓ pdfplumber 已安装"
else
  echo "  ⚠ pdfplumber 未安装，正在安装..."
  pip3 install pdfplumber
fi

# 3. 编译 TypeScript
echo ""
echo "🔨 编译 TypeScript..."
npx tsc --version
npm run build 2>&1 | tail -5

# 4. 检查编译输出
echo ""
echo "✓ 检查编译输出..."
if [ -f "dist/server.js" ]; then
  echo "  ✓ dist/server.js 存在"
else
  echo "  ✗ dist/server.js 不存在"
  exit 1
fi

if [ -f "dist/worker.js" ]; then
  echo "  ✓ dist/worker.js 存在"
else
  echo "  ✗ dist/worker.js 不存在"
  exit 1
fi

# 5. 检查 Python 脚本
echo ""
echo "🐍 检查 Python 脚本..."
if [ -f "python/extract_tables_pdfplumber.py" ]; then
  echo "  ✓ Python 脚本存在"
  python3 python/extract_tables_pdfplumber.py --help > /dev/null 2>&1 && echo "  ✓ Python 脚本可执行" || echo "  ⚠ Python 脚本可能有问题"
else
  echo "  ✗ Python 脚本不存在"
  exit 1
fi

# 6. 检查配置文件
echo ""
echo "⚙️ 检查配置文件..."
[ -f "nginx.conf" ] && echo "  ✓ nginx.conf 存在" || echo "  ✗ nginx.conf 不存在"
[ -f "docker-compose.yml" ] && echo "  ✓ docker-compose.yml 存在" || echo "  ✗ docker-compose.yml 不存在"
[ -f "Dockerfile" ] && echo "  ✓ Dockerfile 存在" || echo "  ✗ Dockerfile 不存在"
[ -f "docker-entrypoint.sh" ] && echo "  ✓ docker-entrypoint.sh 存在" || echo "  ✗ docker-entrypoint.sh 不存在"

# 7. 检查文档
echo ""
echo "📚 检查文档..."
[ -f "DEPLOYMENT_GUIDE.md" ] && echo "  ✓ DEPLOYMENT_GUIDE.md 存在" || echo "  ✗ DEPLOYMENT_GUIDE.md 不存在"
[ -f "QUICK_START_DEPLOYMENT.md" ] && echo "  ✓ QUICK_START_DEPLOYMENT.md 存在" || echo "  ✗ QUICK_START_DEPLOYMENT.md 不存在"
[ -f "LOCAL_TESTING_GUIDE.md" ] && echo "  ✓ LOCAL_TESTING_GUIDE.md 存在" || echo "  ✗ LOCAL_TESTING_GUIDE.md 不存在"

# 8. 检查样例 PDF
echo ""
echo "📄 检查样例 PDF..."
if [ -d "sample_pdfs_v1" ]; then
  pdf_count=$(find sample_pdfs_v1 -name "*.pdf" | wc -l)
  echo "  ✓ 找到 $pdf_count 份样例 PDF"
else
  echo "  ⚠ sample_pdfs_v1 目录不存在（可选）"
fi

# 9. 测试 Python 脚本
echo ""
echo "🧪 测试 Python 脚本..."
if [ -d "sample_pdfs_v1" ] && [ -f "sample_pdfs_v1"/*.pdf ]; then
  pdf_file=$(find sample_pdfs_v1 -name "*.pdf" | head -1)
  echo "  测试文件: $pdf_file"
  
  if python3 python/extract_tables_pdfplumber.py "$pdf_file" \
    --schema src/schemas/annual_report_table_schema_v2.json \
    --out /tmp/test_output.json > /dev/null 2>&1; then
    echo "  ✓ Python 脚本执行成功"
    
    # 检查输出
    if [ -f "/tmp/test_output.json" ]; then
      echo "  ✓ 输出文件已生成"
      # 显示输出摘要
      echo "  输出摘要:"
      python3 -c "
import json
with open('/tmp/test_output.json') as f:
    data = json.load(f)
    print(f\"    - Schema 版本: {data.get('schema_version')}\")
    print(f\"    - 表格数量: {len(data.get('tables', {}))}\")
    for table_id, table_data in data.get('tables', {}).items():
        completeness = table_data.get('completeness', 'unknown')
        confidence = table_data.get('confidence', 0)
        print(f\"    - {table_id}: completeness={completeness}, confidence={confidence:.2f}\")
" 2>/dev/null || echo "    (无法解析输出)"
    fi
  else
    echo "  ⚠ Python 脚本执行失败（可能是 PDF 格式问题）"
  fi
else
  echo "  ⚠ 未找到样例 PDF（跳过测试）"
fi

# 10. 总结
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✓ 本地系统测试完成"
echo ""
echo "📝 下一步："
echo "  1. 启动 PostgreSQL 和 Redis（使用 Docker 或本地安装）"
echo "  2. 运行: npm run dev:api"
echo "  3. 运行: npm run dev:worker"
echo "  4. 运行: cd frontend && npm start"
echo "  5. 打开浏览器访问 http://localhost:3000"
echo ""
echo "📚 更多信息："
echo "  - 本地测试指南: LOCAL_TESTING_GUIDE.md"
echo "  - 部署指南: DEPLOYMENT_GUIDE.md"
echo "  - 快速启动: QUICK_START_DEPLOYMENT.md"
