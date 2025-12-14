#!/bin/bash

# 政府信息公开年度报告差异比对系统 - 本地启动脚本

echo "🚀 启动政府信息公开年度报告差异比对系统..."
echo ""

# 检查环境
echo "📋 检查环境..."
node_version=$(node --version)
npm_version=$(npm --version)
echo "  ✅ Node.js: $node_version"
echo "  ✅ npm: $npm_version"
echo ""

# 检查依赖
echo "📦 检查依赖..."
if [ ! -d "node_modules" ]; then
    echo "  ⚠️  node_modules 不存在，正在安装依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "  ❌ 依赖安装失败"
        exit 1
    fi
    echo "  ✅ 依赖安装完成"
else
    echo "  ✅ 依赖已安装"
fi
echo ""

# 检查环境变量
echo "⚙️  检查环境变量..."
if [ ! -f ".env" ]; then
    echo "  ⚠️  .env 文件不存在，正在创建..."
    cp .env.example .env
    echo "  ✅ .env 文件已创建"
else
    echo "  ✅ .env 文件已存在"
fi
echo ""

# 编译 TypeScript
echo "🔨 编译 TypeScript..."
npm run build
if [ $? -ne 0 ]; then
    echo "  ❌ 编译失败"
    exit 1
fi
echo "  ✅ 编译完成"
echo ""

# 启动应用
echo "🌟 启动应用..."
echo "  应用将在 http://localhost:3000 启动"
echo "  按 Ctrl+C 停止应用"
echo ""

npm start
