FROM node:18-bullseye-slim AS builder

WORKDIR /app

# 安装 Python 和依赖
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# 复制 package 文件
COPY package*.json ./

# 安装 Node 依赖（包括 devDependencies 用于构建）
RUN npm ci

# 复制源代码
COPY src ./src
COPY tsconfig.json ./
COPY jest.config.js ./

# 构建 TypeScript
RUN npm run build

# 复制 Python 依赖文件
COPY python/requirements.txt ./python/requirements.txt

# 安装 Python 依赖
RUN pip3 install --no-cache-dir -r python/requirements.txt

# ============ 生产镜像 ============
FROM node:18-bullseye-slim

WORKDIR /app

# 安装 Python 运行时
RUN apt-get update && apt-get install -y \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# 复制 package 文件
COPY package*.json ./

# 仅安装生产依赖
RUN npm ci --only=production

# 从 builder 阶段复制构建产物
COPY --from=builder /app/dist ./dist

# 复制 Python 脚本和依赖
COPY --from=builder /app/python ./python
COPY --from=builder /usr/local/lib/python3.*/dist-packages /usr/local/lib/python3.11/dist-packages

# 复制 schema 文件
COPY src/schemas ./src/schemas

# 复制迁移文件
COPY migrations ./migrations

# 创建 uploads 目录
RUN mkdir -p /app/uploads

# 暴露端口（仅 API 使用）
EXPOSE 3000

# 启动脚本：先运行迁移，再启动应用
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]
