#!/bin/bash

# Docker Compose 一键启动与验证脚本
# 用于验证系统是否正确启动

set -e

echo "🚀 Docker Compose 启动与验证"
echo "═══════════════════════════════════════════════════════════"

# 1. 构建并启动容器
echo "📦 构建镜像并启动容器..."
docker compose up -d --build

# 等待服务启动
echo "⏳ 等待服务启动（最多 60 秒）..."
sleep 10

# 2. 验证 Nginx 健康检查
echo "🔍 验证 Nginx 健康检查..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
  if curl -sf http://localhost/health > /dev/null 2>&1; then
    echo "✓ Nginx 健康检查通过"
    break
  fi
  attempt=$((attempt + 1))
  echo "  尝试 $attempt/$max_attempts..."
  sleep 2
done

if [ $attempt -eq $max_attempts ]; then
  echo "✗ Nginx 健康检查失败"
  docker compose logs nginx
  exit 1
fi

# 3. 验证 API 可用性
echo "🔍 验证 API 可用性..."
if curl -sf http://localhost/api/v1/tasks > /dev/null 2>&1; then
  echo "✓ API 可用"
else
  echo "⚠ API 响应异常（可能需要鉴权）"
fi

# 4. 验证容器内部诊断
echo "🔍 验证容器内部诊断..."
if docker exec $(docker compose ps -q api) curl -sf http://localhost:3000/health > /dev/null 2>&1; then
  echo "✓ API 容器内部健康检查通过"
else
  echo "✗ API 容器内部健康检查失败"
  docker compose logs api
  exit 1
fi

# 5. 显示容器状态
echo ""
echo "📊 容器状态："
docker compose ps

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✓ 验证完成！系统已成功启动"
echo ""
echo "📝 常用命令："
echo "  查看日志:     docker compose logs -f"
echo "  停止服务:     docker compose down"
echo "  重启服务:     docker compose restart"
echo "  进入容器:     docker compose exec api bash"
