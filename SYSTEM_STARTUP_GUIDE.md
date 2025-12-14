# 系统启动指南

**最后更新**: 2025年1月13日

---

## 🚀 快速启动 (3步)

### 步骤1: 安装依赖

```bash
npm install
```

### 步骤2: 配置环境

```bash
cp .env.example .env
```

### 步骤3: 启动应用

#### macOS/Linux:
```bash
chmod +x start-local.sh
./start-local.sh
```

#### Windows:
```bash
start-local.bat
```

#### 或直接运行:
```bash
npm run build
npm start
```

---

## 📝 详细步骤

### 1. 检查环境

```bash
# 检查 Node.js
node --version
# 需要 18+

# 检查 npm
npm --version
# 需要 8+
```

### 2. 克隆项目

```bash
git clone <repository-url>
cd gov-report-diff
```

### 3. 安装依赖

```bash
npm install

# 如果遇到问题，尝试：
npm install --legacy-peer-deps
```

### 4. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件（可选）
# 默认配置已经可以使用
```

### 5. 编译 TypeScript

```bash
npm run build

# 输出应该在 dist/ 目录
```

### 6. 启动应用

```bash
npm start

# 或开发模式（自动重启）
npm run dev
```

### 7. 验证启动

打开浏览器访问:
```
http://localhost:3000
```

应该看到应用已启动。

---

## 🔧 环境配置

### .env 文件说明

```bash
# 应用端口
PORT=3000

# 数据库配置
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gov_report_diff

# Redis配置
REDIS_URL=redis://localhost:6379

# 存储配置
STORAGE_TYPE=local
STORAGE_PATH=./uploads

# 环境
NODE_ENV=development

# AI配置（可选）
OPENAI_API_KEY=your_api_key_here
```

### 默认配置

系统已配置为本地开发模式，使用：
- 内存数据库 (SQLite 或内存存储)
- 本地文件存储
- 无需外部依赖

---

## 🧪 验证系统

### 方式1: 系统完整性检查

```bash
node test-system.js

# 输出应该显示：
# 🎯 总体完成度: 63/63 (100%)
# ✅ 系统完整性检查通过！所有组件已实现。
```

### 方式2: 运行测试

```bash
# 运行所有测试
npm test

# 运行属性基测试
npm test -- properties.test.ts

# 运行集成测试
npm test -- integration.test.ts
```

### 方式3: 测试API

```bash
# 查询任务列表
curl http://localhost:3000/api/v1/tasks

# 应该返回：
# {"tasks":[],"total":0,"page":1}
```

---

## 📊 启动后的操作

### 1. 查看应用日志

```bash
# 开发模式下，日志直接输出到终端
# 生产模式下，查看日志文件
tail -f logs/app.log
```

### 2. 测试API端点

```bash
# 创建比对任务（上传方式）
curl -X POST http://localhost:3000/api/v1/tasks/compare/upload \
  -F "fileA=@fixtures/sample_pdfs_v1/haq2023.pdf" \
  -F "fileB=@fixtures/sample_pdfs_v1/haq2024.pdf"

# 查询任务列表
curl http://localhost:3000/api/v1/tasks

# 查询任务状态
curl http://localhost:3000/api/v1/tasks/<taskId>
```

### 3. 查看API文档

打开浏览器访问:
```
http://localhost:3000/api/docs
```

或查看 `API.md` 文件。

### 4. 运行完整测试

```bash
npm test

# 应该看到所有测试通过
```

---

## ⚠️ 常见问题

### 问题1: 端口已被占用

```bash
# 错误信息：
# Error: listen EADDRINUSE: address already in use :::3000

# 解决方案1: 修改端口
# 编辑 .env 文件
PORT=3001

# 解决方案2: 杀死占用端口的进程
# macOS/Linux
lsof -i :3000
kill -9 <PID>

# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### 问题2: 依赖安装失败

```bash
# 错误信息：
# npm ERR! code ERESOLVE

# 解决方案1: 清除缓存
npm cache clean --force

# 解决方案2: 使用 --legacy-peer-deps
npm install --legacy-peer-deps

# 解决方案3: 删除 node_modules 重新安装
rm -rf node_modules package-lock.json
npm install
```

### 问题3: TypeScript 编译失败

```bash
# 错误信息：
# error TS2564: Property 'xxx' has no initializer

# 解决方案: 检查 tsconfig.json
# 确保 strictNullChecks 和 strictPropertyInitialization 设置正确

# 或重新编译
npm run build -- --force
```

### 问题4: 模块找不到

```bash
# 错误信息：
# Cannot find module 'xxx'

# 解决方案1: 重新安装依赖
npm install

# 解决方案2: 清除缓存
npm cache clean --force
npm install

# 解决方案3: 检查 package.json
# 确保所有依赖都已列出
```

### 问题5: 权限问题

```bash
# 错误信息：
# Error: EACCES: permission denied

# 解决方案: 修改文件权限
chmod +x start-local.sh

# 或使用 sudo
sudo npm start
```

---

## 🛑 停止应用

### 方式1: 按 Ctrl+C

```bash
# 在终端中按 Ctrl+C 停止应用
```

### 方式2: 杀死进程

```bash
# macOS/Linux
pkill -f "node dist/index.js"

# Windows
taskkill /F /IM node.exe
```

---

## 📚 相关文档

- **快速启动指南**: QUICK_START_GUIDE.md
- **启动说明**: STARTUP_INSTRUCTIONS.md
- **API文档**: API.md
- **部署指南**: DEPLOYMENT.md
- **测试报告**: COMPREHENSIVE_TEST_REPORT.md

---

## 🎯 下一步

1. ✅ 启动应用
2. ✅ 验证系统
3. ✅ 运行测试
4. ✅ 测试API
5. ✅ 查看文档

---

## 💡 提示

- 首次启动可能需要几秒钟
- 应用启动后会自动初始化数据库
- 所有日志都会输出到终端
- 可以在 http://localhost:3000 访问应用

---

**最后更新**: 2025年1月13日  
**版本**: 1.0.0

