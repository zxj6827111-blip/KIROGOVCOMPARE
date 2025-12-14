FROM node:18-bullseye-slim

WORKDIR /app

# 安装 Python 和依赖
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# 复制 package 文件
COPY package*.json ./

# 安装 Node 依赖（包括 devDependencies 用于迁移）
RUN npm ci

# 复制 Python 依赖文件
COPY python/requirements.txt ./python/requirements.txt

# 安装 Python 依赖
RUN pip3 install --no-cache-dir -r python/requirements.txt

# 复制源代码
COPY dist ./dist
COPY src ./src

# 复制 Python 脚本
COPY python ./python

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
