# KIROGOVCOMPARE 上线流程文档

> 目标：在保留现有 AI API Key 的前提下，完成生产部署、配置与上线自检。

## 0) 适用范围与约定

- 单机部署（前后端同域名/同服务器）。
- 后端端口默认 `8787`，前端由 Nginx 托管。
- Node.js 版本要求 `>=20`。

## 1) 环境准备

### 1.1 基础依赖（Ubuntu/Debian 示例）

```bash
sudo apt update
sudo apt install -y git nginx nodejs npm
```

### 1.2 可选依赖

- PostgreSQL（若要替代 SQLite）
- Redis（多实例限流时需要；你可以稍后再配置）

## 2) 域名与证书

1. 域名解析到服务器公网 IP（A 记录）。
2. 申请 HTTPS 证书（建议 Certbot）。

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 3) 代码部署

```bash
git clone <your-repo> /opt/kirogovcompare
cd /opt/kirogovcompare
npm install
cd frontend && npm install
```

## 4) 后端配置（.env）

以下变量必须替换为你的实际值，保留现有 AI Key 不删除：

- `NODE_ENV=production`
- `PORT=8787`
- `FRONTEND_URL=https://your-domain.com`
- `CORS_ALLOWED_ORIGINS=https://your-domain.com`
- `JWT_SECRET=<强随机字符串>`
- `ADMIN_BOOTSTRAP_TOKEN=<强随机字符串>`

数据库：

- 默认 SQLite：`DATABASE_TYPE=sqlite`
- 若使用 PostgreSQL，请设置：
  - `DATABASE_TYPE=postgres`
  - `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD`

限流（你说 Redis 先不处理）：

- 单机可临时使用内存限流：
  - `RATE_LIMIT_STORE=memory`
- 以后需要多实例时再改为：
  - `RATE_LIMIT_STORE=redis`
  - `RATE_LIMIT_REDIS_URL=redis://<redis-host>:6379`

## 5) 前端配置

创建 `frontend/.env.production`：

```
REACT_APP_API_BASE_URL=/api
```

若前后端分域名：`https://api.your-domain.com/api`。

## 6) 构建

```bash
cd /opt/kirogovcompare
npm run build
cd frontend
npm run build
```

## 7) 启动服务

本项目前台依赖 `/api/pdf-jobs` 等接口，建议启动 `index-llm.js`：

```bash
node /opt/kirogovcompare/dist/index-llm.js
```

如果只需要基础 API，可使用：

```bash
node /opt/kirogovcompare/dist/index.js
```

推荐使用 PM2：

```bash
npm install -g pm2
pm2 start /opt/kirogovcompare/dist/index-llm.js --name "kiro-backend"
pm2 save
pm2 startup
```

## 8) Nginx 反向代理

创建 `/etc/nginx/sites-available/kirogovcompare`：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        root /opt/kirogovcompare/frontend/build;
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 100M;
        proxy_read_timeout 300s;
    }
}
```

启用并重载：

```bash
sudo ln -s /etc/nginx/sites-available/kirogovcompare /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 9) 数据目录与权限

```bash
mkdir -p /opt/kirogovcompare/uploads /opt/kirogovcompare/exports
chown -R www-data:www-data /opt/kirogovcompare/uploads /opt/kirogovcompare/exports
chmod 755 /opt/kirogovcompare/uploads /opt/kirogovcompare/exports
```

## 10) 上线前自检清单

1. 健康检查：`curl https://your-domain.com/api/health`
2. 登录 → 创建对比任务 → 任务中心状态更新
3. PDF 导出可用
4. 未登录访问管理接口应返回 401
5. CORS 正常（前端能访问 API）

可选回归：

```bash
npm run test:regression
```

## 11) 安全与运维建议

- `.env` 不要提交到仓库，API Key 定期轮换。
- 只开放 80/443/22 端口，数据库与 Redis 仅内网访问。
- PM2 日志轮转：
  ```bash
  pm2 install pm2-logrotate
  pm2 set pm2-logrotate:max_size 10M
  pm2 set pm2-logrotate:retain 7
  ```

## 12) 回滚策略（建议）

- 构建产物按版本保存（如 `dist-YYYYMMDD`）。
- 回滚时替换软链并重启 PM2。

---

如需我按你的实际域名/服务器路径生成定制版流程，直接告诉我域名与部署目录即可。
