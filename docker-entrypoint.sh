#!/bin/bash
set -e

echo "🔄 Running database migrations..."
npm run db:migrate

echo "✓ Migrations completed"
echo "🚀 Starting application..."

# 执行传入的命令（由 docker-compose 指定）
exec "$@"
