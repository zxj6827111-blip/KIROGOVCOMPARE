# 快速启动指南

## 当前系统定位

本系统当前主流程是：

1. 上传政府信息公开年度报告。
2. 后端解析并入库。
3. 在目录或历史页面中选择同地区不同年份的报告。
4. 使用 `/api/comparisons/*` 生成和查看对比结果。

旧版“直接上传两个 PDF 或输入两个 URL 创建临时任务”的 `/api/v1/tasks/compare/*` 管线已物理清理，不再作为可用功能。

## 本地启动

```bash
npm install
npm run build
npm run start:llm
```

前端：

```bash
cd frontend
npm install
npm start
```

## 健康检查

```bash
npm run health:llm
```

## 管理员账号

管理员初始/重置密码来自 `.env` 中的：

```env
ADMIN_INITIAL_PASSWORD=你的安全密码
```

需要重置本地或服务器 admin 密码和权限时，在后端项目目录执行：

```bash
node -r ts-node/register/transpile-only scripts/reset_admin_password_pg.ts
```

该脚本会确保：

- `admin` 用户存在。
- 密码使用 `ADMIN_INITIAL_PASSWORD` 生成。
- `admin` 用户拥有完整显式权限。

## 当前 Compare 使用方式

前端入口：

- `/history`：查看对比历史。
- `/comparison/:id`：查看某次对比详情。
- `/print/comparison/:id`：打印/PDF 视图。

主要 API：

```http
POST /api/comparisons
GET /api/comparisons/history
GET /api/comparisons/{comparisonId}/result
```

## 已下线的旧 Compare

以下旧接口不再使用：

```http
POST /api/v1/tasks/compare/upload
POST /api/v1/tasks/compare/url
POST /api/v1/tasks/compare/asset
```

如果误访问，会返回 `410 legacy_compare_tasks_retired`。不要再按旧文档用这些接口测试系统。

## 数据库迁移说明

应用启动时会执行统一入口 `runMigrations()`，实际 schema 仍由 `runLLMMigrations()` 保证幂等创建和修补。

当前分支已阻断伪回滚：`rollbackMigration()` 不会删除迁移记录来假装回滚，而是记录 `rollback_blocked` 并失败。

如果未来需要真实回滚能力，需要单独补充 down migration、数据库备份和恢复演练。
