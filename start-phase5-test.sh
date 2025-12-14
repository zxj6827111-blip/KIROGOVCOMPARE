#!/bin/bash

# Phase 5 测试启动脚本
# 同时启动后端 Mock API 和前端应用

echo "🚀 启动 Phase 5 测试环境..."
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未找到 Node.js，请先安装"
    exit 1
fi

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "❌ 未找到 npm，请先安装"
    exit 1
fi

# 编译 TypeScript
echo "📦 编译 TypeScript..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ 编译失败"
    exit 1
fi

echo ""
echo "✅ 编译成功"
echo ""

# 启动后端 Mock API
echo "🔧 启动后端 Mock API (端口 3000)..."
npm run dev &
BACKEND_PID=$!
echo "   后端进程 ID: $BACKEND_PID"

# 等待后端启动
sleep 3

# 检查后端是否启动成功
if ! curl -s http://localhost:3000/health > /dev/null; then
    echo "❌ 后端启动失败"
    kill $BACKEND_PID 2>/dev/null
    exit 1
fi

echo "✅ 后端启动成功"
echo ""

# 启动前端
echo "🎨 启动前端应用 (端口 3001)..."
cd frontend
npm start &
FRONTEND_PID=$!
echo "   前端进程 ID: $FRONTEND_PID"

cd ..

# 等待前端启动
sleep 5

echo ""
echo "✅ 环境启动完成！"
echo ""
echo "📍 访问地址:"
echo "   后端管理页: http://localhost:3000"
echo "   前端应用: http://localhost:3001"
echo ""
echo "🧪 运行测试:"
echo "   npx ts-node scripts/test-phase5-flow.ts"
echo ""
echo "⏹️  停止服务: 按 Ctrl+C"
echo ""

# 等待用户中断
wait
