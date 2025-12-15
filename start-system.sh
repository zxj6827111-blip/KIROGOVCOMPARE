#!/bin/bash

# 🚀 系统启动脚本 - 本地开发模式

set -e

echo "================================"
echo "🚀 启动 Gov Report Diff 系统"
echo "================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 检查函数
check_command() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}✗ $1 未安装${NC}"
        return 1
    fi
    echo -e "${GREEN}✓ $1 已安装${NC}"
    return 0
}

# 检查服务运行状态
check_service() {
    if brew services list | grep -q "$1.*started"; then
        echo -e "${GREEN}✓ $1 已运行${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠ $1 未运行${NC}"
        return 1
    fi
}

# 第 1 步：检查系统要求
echo -e "${BLUE}第 1 步：检查系统要求${NC}"
echo ""

check_command "node" || exit 1
check_command "npm" || exit 1
check_command "psql" || exit 1
check_command "redis-cli" || exit 1

echo ""

# 第 2 步：启动数据库服务
echo -e "${BLUE}第 2 步：启动数据库服务${NC}"
echo ""

if ! check_service "postgresql@15"; then
    echo "启动 PostgreSQL..."
    brew services start postgresql@15
    sleep 2
fi

if ! check_service "redis"; then
    echo "启动 Redis..."
    brew services start redis
    sleep 2
fi

echo ""

# 第 3 步：验证数据库连接
echo -e "${BLUE}第 3 步：验证数据库连接${NC}"
echo ""

if psql -h localhost -U postgres -c "SELECT 1" &> /dev/null; then
    echo -e "${GREEN}✓ PostgreSQL 连接成功${NC}"
else
    echo -e "${RED}✗ PostgreSQL 连接失败${NC}"
    exit 1
fi

if redis-cli ping &> /dev/null; then
    echo -e "${GREEN}✓ Redis 连接成功${NC}"
else
    echo -e "${RED}✗ Redis 连接失败${NC}"
    exit 1
fi

echo ""

# 第 4 步：检查依赖
echo -e "${BLUE}第 4 步：检查依赖${NC}"
echo ""

if [ ! -d "node_modules" ]; then
    echo "安装后端依赖..."
    npm install
fi

if [ ! -d "frontend/node_modules" ]; then
    echo "安装前端依赖..."
    cd frontend && npm install && cd ..
fi

echo -e "${GREEN}✓ 依赖检查完成${NC}"
echo ""

# 第 5 步：显示启动说明
echo -e "${BLUE}第 5 步：启动系统${NC}"
echo ""
echo "现在需要打开 3 个独立的终端窗口，分别运行以下命令："
echo ""
echo -e "${YELLOW}终端 1 - API 服务器：${NC}"
echo "  npm run dev:api"
echo ""
echo -e "${YELLOW}终端 2 - Worker 进程：${NC}"
echo "  npm run dev:worker"
echo ""
echo -e "${YELLOW}终端 3 - 前端应用：${NC}"
echo "  cd frontend && npm start"
echo ""

# 第 6 步：询问是否自动打开终端
echo -e "${BLUE}是否自动打开终端？${NC}"
echo ""
echo "选项："
echo "  1) 是，自动打开 3 个终端"
echo "  2) 否，我手动打开"
echo ""
read -p "请选择 (1 或 2): " choice

if [ "$choice" = "1" ]; then
    echo ""
    echo "打开终端 1 - API 服务器..."
    open -a Terminal <<EOF
cd "$(pwd)" && npm run dev:api
EOF
    sleep 2

    echo "打开终端 2 - Worker 进程..."
    open -a Terminal <<EOF
cd "$(pwd)" && npm run dev:worker
EOF
    sleep 2

    echo "打开终端 3 - 前端应用..."
    open -a Terminal <<EOF
cd "$(pwd)" && cd frontend && npm start
EOF
    sleep 2

    echo ""
    echo -e "${GREEN}✓ 所有终端已打开${NC}"
    echo ""
    echo "等待 10 秒后验证系统..."
    sleep 10

    echo ""
    echo -e "${BLUE}验证系统${NC}"
    echo ""

    if curl -s http://localhost:3000/health | grep -q "ok"; then
        echo -e "${GREEN}✓ API 服务器运行正常${NC}"
    else
        echo -e "${YELLOW}⚠ API 服务器可能还在启动中${NC}"
    fi

    echo ""
    echo -e "${GREEN}✓ 系统启动完成！${NC}"
    echo ""
    echo "打开浏览器访问：http://localhost:3000"
    echo ""
else
    echo ""
    echo -e "${YELLOW}请手动打开 3 个终端并运行上述命令${NC}"
    echo ""
fi

echo "================================"
echo "✨ 启动脚本完成"
echo "================================"
