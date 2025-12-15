#!/bin/bash

# 等待 PostgreSQL 安装完成的脚本

echo "⏳ 等待 PostgreSQL 安装完成..."
echo ""

# 检查 PostgreSQL 安装进程
while pgrep -f "postgresql@15" > /dev/null; do
    echo "⏳ PostgreSQL 仍在编译中... $(date '+%H:%M:%S')"
    sleep 10
done

echo ""
echo "✅ PostgreSQL 安装完成！"
echo ""

# 验证 PostgreSQL 安装
if command -v psql &> /dev/null; then
    echo "✅ PostgreSQL 已成功安装"
    psql --version
else
    echo "❌ PostgreSQL 安装可能失败，请检查"
    exit 1
fi

echo ""
echo "现在可以安装 Redis 了"
echo "运行: brew install redis"
