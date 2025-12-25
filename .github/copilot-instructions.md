# 政府信息公开年度报告差异比对系统 - AI 编程助手指南

## 项目概述

这是一个**双模式**系统，用于比对政府年度报告的 PDF 文件并生成差异分析：

- **主系统**（端口 3000）：传统的 PDF 解析与比对（使用队列/Redis）
- **LLM 系统**（端口 8787）：基于 LLM 的年报解析与智能比对（轮询作业模型）

## 架构关键点

### 1. 双数据库支持
系统在多处支持 PostgreSQL 和 SQLite 切换（通过 `DATABASE_TYPE` 环境变量）：
- **主系统**: 使用 `src/config/database.ts`（仅 PostgreSQL + Redis）
- **LLM 系统**: 使用 `src/config/database-llm.ts`（PostgreSQL 或 SQLite）
  - SQLite 辅助层在 `src/config/sqlite.ts` 中提供 `querySqlite()` 和 `sqlValue()` 函数
  - 路由层需显式检查 `dbType` 来切换 SQL 语法（如 `$1` vs `?` 占位符）

```typescript
// 示例：路由中的数据库类型检查
import pool, { dbType } from '../config/database-llm';
if (dbType === 'sqlite') {
  const rows = querySqlite(`SELECT * FROM regions WHERE id = ${sqlValue(id)}`);
} else {
  const result = await pool.query('SELECT * FROM regions WHERE id = $1', [id]);
}
```

### 2. 两套服务入口
- **主服务**: `src/index.ts` / `src/index-dev.ts` - 启动队列处理器和传统 API
- **LLM 服务**: `src/index-llm.ts` - 启动 LlmJobRunner 和 LLM API（不依赖 Redis）
  - 运行命令: `npm run dev:llm`
  - 健康检查: `npm run health:llm`
  - 端口管理: `npm run ports:llm` / `start:llm` / `stop:llm`

### 3. LLM 作业调度
`src/services/LlmJobRunner.ts` 是 LLM 系统的核心：
- **轮询模式**：每 2 秒检查 `jobs` 表中的 `queued` 作业
- 作业类型：`parse`（解析年报）、`compare`（比对两个版本）
- 提供商工厂：`src/services/LlmProviderFactory.ts` 根据环境变量选择 LLM 提供商
  - 目前支持：`GeminiLlmProvider`、`StubLlmProvider`（测试用）

### 4. 路由挂载顺序至关重要
在 `src/index-llm.ts` 中，路由必须按特定顺序挂载以避免冲突：

```typescript
// 正确顺序（勿调整）：
app.use('/api/regions', regionsImportRouter);    // 先挂载 /template, /export
app.use('/api/regions', llmRegionsRouter);        // 再挂载通用 regions 路由
app.use('/api/comparisons', comparisonHistoryRouter); // 先挂载 history
app.use('/api', llmComparisonsRouter);            // 再挂载 comparisons
```

## 开发工作流

### 本地开发（LLM 系统）
```bash
npm run dev:llm          # 启动 LLM 服务（SQLite 模式，端口 8787）
npm run health:llm       # 检查服务健康状态
npm run smoke:llm        # 运行冒烟测试
```

### 测试与验证
```bash
npm test                 # 运行所有测试
npm run test:unit        # 仅单元测试
npm run test:integration # 仅集成测试
npm run test:pbt         # 属性基测试
```

### Docker 部署
```bash
docker-compose up -d     # 启动 PostgreSQL + Redis + 主应用
```

## 关键约定

### 1. 服务单例模式
所有服务类导出单例实例：
```typescript
export class MyService { /* ... */ }
export default new MyService();  // 或 export const myService = new MyService();
```

### 2. SQLite 查询辅助函数
在 SQLite 模式下使用 `querySqlite()` 和 `sqlValue()` 防止 SQL 注入：
```typescript
import { querySqlite, sqlValue } from '../config/sqlite';
const rows = querySqlite(`SELECT * FROM table WHERE id = ${sqlValue(id)}`);
```

### 3. 迁移管理
- 主系统迁移：`migrations/*.sql`（PostgreSQL）
- LLM 迁移：`migrations/sqlite/*.sql` + `src/db/migrations-llm.ts`
  - `ensureSqliteMigrations()` 在 SQLite 模式下自动创建表

### 4. 前端集成
前端位于 `frontend/` 目录（React 应用）：
- API 客户端：`frontend/src/apiClient.js`
- 组件在 `frontend/src/components/` 中按功能组织

## 常见任务

### 添加新的 LLM 作业类型
1. 在 `jobs` 表中添加 `kind` 枚举值（见 `migrations/sqlite/001_llm_ingestion_schema.sql`）
2. 在 `LlmJobRunner.ts` 的 `processJob()` 中添加处理分支
3. 更新前端 API 客户端以提交新作业

### 添加新的 LLM 提供商
1. 在 `src/services/` 创建 `XxxLlmProvider.ts` 实现 `LlmProvider` 接口
2. 在 `LlmProviderFactory.ts` 注册新提供商
3. 设置环境变量 `LLM_PROVIDER=xxx`

### 调试数据库查询
- SQLite: 数据库文件在 `data/gov-reports-llm.db`，可用 SQLite 客户端查看
- PostgreSQL: 查看 docker-compose 日志或连接 `localhost:5432`

## 文档参考
- API 规范：[API.md](API.md)
- 快速入门：[QUICK_START_GUIDE.md](QUICK_START_GUIDE.md)
- 部署指南：[DEPLOYMENT.md](DEPLOYMENT.md)
- 实现指南：[IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md)
- 控制字符处理：[docs/sanitize_control_chars.md](docs/sanitize_control_chars.md)
