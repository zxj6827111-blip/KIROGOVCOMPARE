---
description: 如何在本地编译前端并部署到服务器
---

此工作流指导您如何在本地电脑上编译前端代码，然后将其上传到云端服务器，以避免在服务器上进行缓慢的编译过程。

### 1. 本地编译 (在您的开发机上)

打开本地终端（或 VS Code 终端）：

1.  进入前端目录：
    ```bash
    cd frontend
    ```
2.  执行构建命令（确保生成生产环境代码）：
    ```bash
    npm run build
    ```
    *执行完毕后，会在 `frontend` 目录下生成一个 `build` 文件夹。*

3.  打包构建产物：
    *   **Windows**: 进入 `frontend` 目录，右键点击 `build` 文件夹 -> "发送到" -> "压缩(zipped)文件夹"，命名为 `build.zip`。
    *   **Mac/Linux**: `zip -r build.zip build/`

### 2. 上传文件到服务器

使用您习惯的 SFTP 工具（如 Termius, Xshell, FileZilla）或命令行：

1.  将本地的 `frontend/build.zip` 上传到服务器的指定目录。
    *   *建议上传到与项目并列的位置，方便操作，例如 `/opt/kirogovcompare/frontend_dist_temp/`*

### 3. 服务器端部署

登录远程服务器终端：

1.  找到您现在的 Nginx 静态文件目录或前端部署目录。
    *   *通常在 `/var/www/html` 或者您项目目录下的某个位置。如果您目前是通过 `npm start` 在服务器运行开发模式，建议改为 Nginx 托管静态文件以提升性能。*

2.  解压并覆盖：
    ```bash
    # 假设您上传到了 /tmp/build.zip，目标网站目录是 /var/www/html/dist
    
    # 1. 备份旧版 (可选)
    mv /var/www/html/dist /var/www/html/dist_bak_$(date +%F)
    
    # 2. 解压新版
    unzip /tmp/build.zip -d /tmp/frontend_build
    mv /tmp/frontend_build/build /var/www/html/dist
    
    # 3. 清理临时文件
    rm -rf /tmp/frontend_build /tmp/build.zip
    ```

### 补充说明
如果您目前在服务器上是直接用 `npm start` (端口3001) 来运行前端的，那是**开发模式**，确实会很卡。
**强烈建议**在生产环境使用 Nginx 反向代理来服务前端静态文件 (即刚才编译出的 `build` 目录)，并将 API 请求转发给后端端口 (8787)。

**Nginx 配置示例 (仅供参考):**
```nginx
server {
    listen 80;
    server_name your_server_ip;

    # 前端静态文件
    location / {
        root /var/www/html/dist; # 指向您解压的 build 目录
        index index.html;
        try_files $uri $uri/ /index.html; # 支持 React 路由
    }

    # 后端 API 转发
    location /api/ {
        proxy_pass http://127.0.0.1:8787/;
        proxy_set_header Host $host;
    }
}
```
