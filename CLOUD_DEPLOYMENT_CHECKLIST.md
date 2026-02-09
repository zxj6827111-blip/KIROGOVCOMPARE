# KIROGOVCOMPARE 云服务器部署清单

> **目标**: 将政府年报比对系统部署到云服务器,确保生产环境稳定运行

---

## 🔄 从测试服务器迁移到生产服务器

> 本章节适用于已在测试服务器验证完成后，需要迁移到正式生产服务器的场景。

### 第一步：测试服务器备份导出

在 **测试服务器** 上执行：

```bash
# 创建备份目录
mkdir -p /opt/kirogovcompare/exports
cd /opt/kirogovcompare/exports

# 1. 备份 .env 配置文件
cp /opt/kirogovcompare/.env ./kiro-env-backup.txt

# 2. 备份完整数据库（结构 + 数据）
PGPASSWORD=admin123 pg_dump -U kiro_app -d gov_report_diff -h localhost > kiro-db-full-$(date +%Y%m%d).sql

# 3. 查看备份文件
ls -la /opt/kirogovcompare/exports/
```

使用 FinalShell 或 scp 下载 `/opt/kirogovcompare/exports/` 目录下的文件到本地。

### 第二步：新服务器环境准备

```bash
# 更新系统
apt update && apt upgrade -y

# 安装 Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# 安装 PostgreSQL
apt install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql

# 安装 Redis
apt install -y redis-server
systemctl enable redis-server

# 安装 Nginx
apt install -y nginx
systemctl enable nginx

# 安装 PM2
npm install -g pm2

# 安装 Chrome 依赖（用于 PDF 导出）
apt install -y fonts-liberation libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libnss3 libnspr4 libasound2 \
    libpango-1.0-0 libpangocairo-1.0-0 libcairo2 libatspi2.0-0 \
    fonts-noto-cjk fonts-noto-cjk-extra
```

### 第三步：配置 PostgreSQL 数据库

```bash
sudo -u postgres psql
```

```sql
-- 创建用户
CREATE USER kiro_app WITH PASSWORD 'your_strong_password';

-- 创建数据库
CREATE DATABASE gov_report_diff OWNER kiro_app;

-- 授权
GRANT ALL PRIVILEGES ON DATABASE gov_report_diff TO kiro_app;

-- 退出
\q
```

导入备份数据：

```bash
PGPASSWORD=your_strong_password psql -U kiro_app -d gov_report_diff -h localhost < /path/to/kiro-db-full-YYYYMMDD.sql
```

### 第四步：部署应用代码

```bash
# 克隆代码
cd /opt
git clone https://github.com/your-org/KIROGOVCOMPARE.git kirogovcompare
cd kirogovcompare
git checkout fix/cloud-admin-login  # 或 main 分支

# 复制 .env 配置（从备份或手动创建）
nano .env

# 安装依赖并编译
npm install
npm run build

cd frontend
npm install
npm run build
cd ..

# 创建数据目录
mkdir -p /opt/kirogovcompare/data/uploads
mkdir -p /opt/kirogovcompare/data/exports
```

### 第五步：启动服务

```bash
# 使用 PM2 启动
pm2 start npm --name kiro-backend -- start

# 保存配置并设置开机自启
pm2 save
pm2 startup
```

### 第六步：验证部署

```bash
# 检查后端 API
curl http://localhost:8787/api/regions

# 检查 PM2 状态
pm2 status
```

浏览器访问验证：
- ✅ 首页正常加载
- ✅ 管理员登录成功
- ✅ 区域列表显示正确
- ✅ 报告问题标签正确显示
- ✅ PDF 导出正常
- ✅ 用户数据范围过滤正常

---

## 📋 部署前检查清单

### 1. 服务器环境要求

| 组件 | 最低要求 | 推荐配置 |
|------|----------|----------|
| CPU | 2 核 | 4 核+ |
| 内存 | 4 GB | 8 GB+ |
| 磁盘 | 50 GB SSD | 100 GB+ SSD |
| OS | Ubuntu 20.04+ / CentOS 8+ | Ubuntu 22.04 LTS |
| Node.js | 18.x | 20.x LTS |
| 数据库 | PostgreSQL 14+ | PostgreSQL 15+ |

### 2. 需要安装的软件

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y nodejs npm postgresql redis-server nginx git

# 或使用 Docker
sudo apt install -y docker.io docker-compose
```

---

## ⚠️ 关键配置修改清单

### 【必须配置】环境变量确认

> [!TIP]
> 代码库已经优化，不再包含硬编码的 `localhost`。**只需要确保环境变量配置正确即可**。

请重点检查下列配置项是否在 `.env` 文件中正确设置：

#### 1. 前端连接后端
确保 `frontend/.env.production` 中设置了正确的 API 地址：
```bash
REACT_APP_API_BASE_URL=http://64.181.246.139:8787/api
```

#### 2. 后端 CORS 与 回调
确保后端 `.env` 中允许了前端的 IP/域名访问：
```bash
# 允许前端访问后端 API
CORS_ALLOWED_ORIGINS=http://64.181.246.139,http://64.181.246.139:80,http://64.181.246.139:3000

# 用于 PDF 导出等功能找回前端资源
FRONTEND_URL=http://64.181.246.139
```

---

## 🔧 环境配置文件

### 后端 `.env` 文件配置

```bash
# ========================
# 生产环境配置模板
# ========================

# 数据库配置 (PostgreSQL)
DATABASE_TYPE=postgres
DB_HOST=localhost          # 数据库在本机
DB_PORT=5432
DB_NAME=gov_report_diff
DB_USER=postgres
DB_PASSWORD=YOUR_STRONG_PASSWORD  # 使用强密码!

# Redis 配置
REDIS_HOST=localhost       # Redis 在本机
REDIS_PORT=6379
REDIS_DB=0

# 服务器配置
PORT=8787                  # 后端 API 端口
NODE_ENV=production
# 您的服务器 IP
FRONTEND_URL=http://64.181.246.139
CORS_ALLOWED_ORIGINS=http://64.181.246.139,http://64.181.246.139:80

# 文件存储
STORAGE_TYPE=local         # 或 s3
STORAGE_PATH=./uploads

# AI 配置 (重要!)
LLM_PROVIDER=gemini
LLM_MODEL=gemini-1.5-pro
GOOGLE_API_KEY=YOUR_GEMINI_API_KEY  # Gemini API Key

# Fallback 模型
LLM_FALLBACK_PROVIDER=glm
LLM_FALLBACK_MODEL=glm-4-plus
GLM_API_KEY=YOUR_GLM_API_KEY        # 智谱 API Key

# 日志
LOG_LEVEL=info
```

### 前端构建环境变量

在 `frontend/` 目录创建 `.env.production` 文件:

```bash
# frontend/.env.production
REACT_APP_API_BASE_URL=http://64.181.246.139:8787/api
```

---

## 🚀 部署步骤

### 方案一: 直接部署 (推荐新手)

#### Step 1: 上传代码

```bash
# 在服务器上
git clone https://your-repo-url.git /opt/kirogovcompare
cd /opt/kirogovcompare
```

#### Step 2: 安装依赖

```bash
# 后端
npm install

# 前端
cd frontend
npm install
```

#### Step 3: 配置环境变量

```bash
# 后端
cp .env.example .env
nano .env  # 编辑配置

# 前端
cd frontend
echo "REACT_APP_API_BASE_URL=/api" > .env.production
```

#### Step 4: 构建

```bash
# 后端构建
npm run build

# 前端构建
cd frontend
npm run build
```

#### Step 5: 启动服务

```bash
# 使用 PM2 管理进程 (推荐)
npm install -g pm2

# 启动后端 (使用 production 预设)
npm run start:prod

# 或者直接使用 PM2 (推荐生产环境)
pm2 start dist/index-llm.js --name "kiro-backend" --node-args="-r dotenv/config"

# 查看状态
pm2 status
pm2 logs kiro-backend
```

---

### 方案二: Docker 部署

#### Step 1: 修改 docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: gov_report_diff
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${DB_PASSWORD}  # 从 .env 读取
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: always

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: always

  backend:
    build: .
    environment:
      - DATABASE_TYPE=postgres
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_NAME=gov_report_diff
      - DB_USER=postgres
      - DB_PASSWORD=${DB_PASSWORD}
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - PORT=8787
      - NODE_ENV=production
      - GOOGLE_API_KEY=${GOOGLE_API_KEY}
    ports:
      - "8787:8787"
    depends_on:
      - postgres
      - redis
    volumes:
      - ./uploads:/app/uploads
      - ./exports:/app/exports
    restart: always

  frontend:
    build:
      context: ./frontend
      args:
        REACT_APP_API_BASE_URL: http://64.181.246.139:8787/api
    ports:
      - "3001:80"
    depends_on:
      - backend
    restart: always

volumes:
  postgres_data:
  redis_data:
```

#### Step 2: 创建前端 Dockerfile

在 `frontend/` 目录创建:

```dockerfile
# frontend/Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG REACT_APP_API_BASE_URL=/api
ENV REACT_APP_API_BASE_URL=$REACT_APP_API_BASE_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

#### Step 3: 启动

```bash
docker-compose up -d --build
```

---

## 🌐 Nginx 反向代理配置

创建 `/etc/nginx/sites-available/kirogovcompare`:

```nginx
server {
    listen 80;
    server_name 64.181.246.139;

    # 前端静态文件
    location / {
        root /opt/kirogovcompare/frontend/build;
        try_files $uri $uri/ /index.html;
        
        # 缓存静态资源
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }

    # API 反向代理
    location /api {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 上传文件大小限制
        client_max_body_size 100M;
        
        # 超时设置 (AI 解析可能较慢)
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # 打印页面专用路由
    location /print {
        root /opt/kirogovcompare/frontend/build;
        try_files $uri /index.html;
    }
}
```

启用配置:

```bash
sudo ln -s /etc/nginx/sites-available/kirogovcompare /etc/nginx/sites-enabled/
 
# ⚠️ 重要: 移除默认配置，否则可能显示 "Welcome to Nginx"
sudo rm /etc/nginx/sites-enabled/default
 
sudo nginx -t
sudo systemctl reload nginx
```

---

## 🔒 安全配置清单

### 1. HTTPS 配置 (Let's Encrypt)

```bash
# 安装 certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书 (如果有域名)
sudo certbot --nginx -d your-domain.com

# 如果仅使用 IP (64.181.246.139)，则无法使用 Let's Encrypt，跳过此步仅使用 HTTP
```

### 2. 防火墙配置

```bash
# UFW (Ubuntu)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# 内部端口不要对外开放!
# 8787 (后端), 5432 (PostgreSQL), 6379 (Redis) 应只允许本地访问
```

### 3. 数据库安全

```bash
# PostgreSQL - 修改 pg_hba.conf
# 只允许本地连接或特定 IP

# 创建专用数据库用户 (非 superuser)
CREATE USER kiro_app WITH PASSWORD 'strong_password';
GRANT ALL PRIVILEGES ON DATABASE gov_report_diff TO kiro_app;
```

### 4. API Key 安全

> [!WARNING]
> 绝对不要将 API Key 提交到 Git 仓库!

- 使用环境变量存储 API Key
- 定期轮换 API Key
- 设置 API 使用配额和告警

### 5. 🔑 认证安全配置 (必须!)

> [!CAUTION]
> 部署前 **必须** 设置以下安全环境变量，否则服务将拒绝启动!

#### Step 1: 生成强随机密钥

```bash
# 生成 JWT_SECRET (至少32字符)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 生成 ADMIN_BOOTSTRAP_TOKEN (至少16字符)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

#### Step 2: 添加到 .env 文件

```bash
# .env
JWT_SECRET=你生成的64位十六进制字符串
ADMIN_BOOTSTRAP_TOKEN=你生成的32位十六进制字符串
```

#### Step 3: 重置默认管理员密码

> [!IMPORTANT]
> 系统不再接受默认密码 `admin123` 登录。必须使用以下接口重置密码。

```bash
curl -X POST http://localhost:8787/api/auth/reset-default-password \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "currentPassword": "admin123",
    "newPassword": "你的新安全密码(至少8位)",
    "bootstrapToken": "你设置的ADMIN_BOOTSTRAP_TOKEN值"
  }'
```

成功响应:
```json
{"message": "密码重置成功，请使用新密码登录"}
```

#### 安全配置验证

```bash
# 验证未认证请求被拒绝
curl http://localhost:8787/api/v1/assets
# 预期: {"error":"未登录，请先登录"}

# 验证 SSRF 防护
curl -X POST http://localhost:8787/api/v1/tasks/compare/url \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"urlA":"http://169.254.169.254/latest/meta-data","urlB":"..."}'
# 预期: {"error":"URL被SSRF防护拒绝，不支持内网地址"}
```

---

## 📊 数据库初始化

### PostgreSQL 设置

```bash
# 登录 PostgreSQL
sudo -u postgres psql

# 创建数据库
CREATE DATABASE gov_report_diff;

# 运行迁移 (从项目目录)
cd /opt/kirogovcompare
npm run build
# 迁移脚本会在首次启动时自动执行
```

### 数据迁移说明（PG-only）

当前仓库已切换为 PostgreSQL 单数据库模式，不再维护 SQLite 迁移脚本。

如需迁移历史数据，请在离线环境通过 SQL 导入/ETL 工具写入 PostgreSQL，并在导入后执行应用层校验接口进行抽检。

---

## 📁 文件存储配置

### 本地存储

```bash
# 创建上传目录
mkdir -p /opt/kirogovcompare/uploads
mkdir -p /opt/kirogovcompare/exports

# 设置权限
chown -R www-data:www-data /opt/kirogovcompare/uploads
chmod 755 /opt/kirogovcompare/uploads
```

### 云存储 (可选)

如使用 S3 或 OSS:

```bash
# .env 配置
STORAGE_TYPE=s3
AWS_REGION=ap-east-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
S3_BUCKET=kirogovcompare-uploads
```

---

## 🔍 健康检查与监控

### 健康检查接口

```bash
# 检查后端状态
curl https://your-domain.com/api/health

# 预期响应
{"status":"ok","timestamp":"...","database":"connected"}
```

### PM2 监控

```bash
# 查看进程状态
pm2 status

# 查看 CPU/内存使用
pm2 monit

# 设置开机自启
pm2 startup
pm2 save
```

### 日志管理

```bash
# 查看日志
pm2 logs kiro-backend

# 日志轮转
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

---

## 🐛 常见问题排查

### 1. 前端 API 请求失败

**症状**: 控制台显示 `Failed to fetch` 或 CORS 错误

**解决方案**:
- 检查 `REACT_APP_API_BASE_URL` 是否正确设置
- 确认 Nginx 反向代理配置正确
- 检查后端是否正常运行: `pm2 status`

### 2. 数据库连接失败

**症状**: 启动时报 `ECONNREFUSED`

**解决方案**:
```bash
# 检查 PostgreSQL 状态
sudo systemctl status postgresql

# 检查连接
psql -h localhost -U postgres -d gov_report_diff
```

### 3. AI 解析失败

**症状**: 上传文件后任务一直处于"处理中"

**解决方案**:
- 检查 API Key 是否配置正确
- 查看后端日志: `pm2 logs kiro-backend`
- 确认服务器能访问 AI API (某些云服务器需要配置代理)

### 4. 文件上传失败

**症状**: 上传大文件时失败

**解决方案**:
```nginx
# Nginx 配置增加上传大小限制
client_max_body_size 100M;
```

---

## ✅ 部署验证清单

部署完成后,逐项验证:

- [ ] 访问首页能正常加载
- [ ] 能够登录系统
- [ ] 城市管理页面能加载区域列表
- [ ] 能上传 PDF 文件并开始解析
- [ ] 任务中心显示任务状态
- [ ] 比对结果能正确显示
- [ ] PDF 导出功能正常
- [ ] HTTPS 证书有效
- [ ] 日志正常记录

---

## 📞 技术支持

如遇到部署问题:

1. 查看后端日志: `pm2 logs`
2. 检查 Nginx 错误日志: `/var/log/nginx/error.log`
3. 确认所有服务运行状态: `systemctl status postgresql redis-server nginx`

## GovInsight Materialized View

- The dashboard API uses the materialized view `gov_open_annual_stats`.
- After restoring data on a new server, run: `REFRESH MATERIALIZED VIEW gov_open_annual_stats;`
- Current backend refresh policy: single upload refreshes after materialize succeeds; batch upload refreshes once when the batch is completed.
