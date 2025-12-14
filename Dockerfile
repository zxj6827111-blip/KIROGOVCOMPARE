FROM node:18-alpine

WORKDIR /app

# 复制package文件
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制源代码
COPY dist ./dist

# 暴露端口
EXPOSE 3000

# 启动应用
CMD ["node", "dist/index.js"]
