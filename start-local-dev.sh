#!/bin/bash

# 本地开发启动脚本
# 用于启动 API、Worker 和前端

echo "🚀 启动本地开发环境"
echo "═══════════════════════════════════════════════════════════"

# 检查环境
echo "📋 检查环境..."
echo "  ✓ Node.js: $(node --version)"
echo "  ✓ npm: $(npm --version)"
echo "  ✓ Python: $(python3 --version)"

# 检查依赖
echo ""
echo "📦 检查依赖..."
if [ ! -d "node_modules" ]; then
  echo "  安装 Node 依赖..."
  npm install
fi

# 编译 TypeScript
echo ""
echo "🔨 编译 TypeScript..."
npm run build

# 启动服务
echo ""
echo "🎯 启动服务..."
echo ""
echo "⚠️  注意：需要在 3 个独立的终端中运行以下命令："
echo ""
echo "终端 1 - 启动 API:"
echo "  npm run dev:api"
echo ""
echo "终端 2 - 启动 Worker:"
echo "  npm run dev:worker"
echo ""
echo "终端 3 - 启动前端:"
echo "  cd frontend && npm start"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "📝 提示："
echo "  1. 确保 PostgreSQL 和 Redis 已启动"
echo "  2. 保持所有 3 个终端打开"
echo "  3. 打开浏览器访问 http://localhost:3000"
echo ""
echo "🧪 测试系统："
echo "  curl http://localhost:3000/health"
echo ""
