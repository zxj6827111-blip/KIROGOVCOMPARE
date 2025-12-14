#!/bin/bash

# 启动前后端服务脚本

echo "🚀 启动政府信息公开年度报告差异比对系统..."
echo ""

# 检查后端依赖
echo "📦 检查后端依赖..."
if [ ! -d "node_modules" ]; then
    echo "  安装后端依赖..."
    npm install
fi

# 编译后端
echo "🔨 编译后端..."
npm run build

# 检查前端依赖
echo "📦 检查前端依赖..."
if [ ! -d "frontend/node_modules" ]; then
    echo "  安装前端依赖..."
    cd frontend
    npm install
    cd ..
fi

echo ""
echo "✅ 准备完成！"
echo ""
echo "启动后端服务..."
node dist/index-mock.js &
BACKEND_PID=$!

echo "启动前端服务..."
cd frontend
npm start &
FRONTEND_PID=$!

cd ..

echo ""
echo "🎉 服务已启动！"
echo ""
echo "📍 后端: http://localhost:3000"
echo "📍 前端: http://localhost:3000 (React 开发服务器)"
echo ""
echo "按 Ctrl+C 停止所有服务"
echo ""

# 等待进程
wait $BACKEND_PID $FRONTEND_PID
