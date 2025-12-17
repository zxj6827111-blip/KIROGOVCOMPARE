# 快速修正指南

## 🎯 核心决策（必须先确认）

### 决策 1：数据库选择

**当前矛盾**：
- HLD 说 SQLite（Phase 1 默认）
- CORRECTIONS 和 ACCEPTANCE 说 PostgreSQL

**建议决策**：
```
✅ Phase 1 采用 PostgreSQL（生产就绪）
✅ 本地开发可用 SQLite（可选）
✅ 迁移脚本支持两种数据库
```

**修正步骤**：
1. HLD 第 3.1 章：改为"Phase 1 采用 PostgreSQL"
2. 提供完整的 PostgreSQL SQL（不要注释）
3. 提供完整的 SQLite SQL（作为备选）
4. 迁移脚本支持 `--db=postgres|sqlite` 参数

---

### 决策 2：幂等策略

**当前矛盾**：
- 旧内容：按 `file_hash` 全局唯一
- 新内容：按 `(region_id, year)` 组合唯一

**建议决策**：
```
✅ 使用三元组唯一键：UNIQUE(region_id, year, file_hash)
✅ 含义：同城同年同文件只有一份 report
✅ 支持：同城同年不同文件可以有多份 report
```

**修正步骤**：
1. HLD 第 3.1 章 reports 表：改为 `UNIQUE(region_id, year, file_hash)`
2. HLD 第 5.4 章幂等策略：更新为三元组逻辑
3. HLD 第 4.1 章 API 示例：补充 409 响应示例
4. HLD 第 4.8 章错误码：更新 REPORT_ALREADY_EXISTS 描述

---

### 决策 3：Prompt 管理

**当前矛盾**：
- CORRECTIONS 说 `src/prompts/v1/` 目录结构
- HLD 说 `prompts/v1.md` 文件结构

**建议决策**：
```
✅ 采用目录结构：src/prompts/v{n}/
✅ 文件组织：
   - system.txt（系统提示词）
   - user.txt（用户提示词模板）
   - schema.json（输出 JSON Schema）
✅ 运行时加载：按 PROMPT_VERSION 环境变量读取
```

**修正步骤**：
1. HLD 第 5.4 章：统一为目录结构
2. 补充 PromptManager 的完整实现示例
3. 补充 Prompt 版本变更流程

---

## 📝 具体修正清单

### HLD_LLM_INGESTION.md

#### 修正 1：数据库表设计（第 3.1 章）

**当前**：
```sql
UNIQUE(region_id, year)  -- 业务唯一
```

**改为**：
```sql
-- PostgreSQL
UNIQUE(region_id, year, file_hash)

-- SQLite
UNIQUE(region_id, year, file_hash)
```

---

#### 修正 2：幂等策略（第 5.4 章）

**当前**：
```
选项 A（推荐）：复用已有版本
1. 计算上传 PDF 的 SHA256 hash
2. 查询 reports 表，WHERE file_hash = ?
```

**改为**：
```
采用三元组唯一键策略：
1. 计算上传 PDF 的 SHA256 hash
2. 查询 reports 表，WHERE region_id = ? AND year = ? AND file_hash = ?
3. 若存在：返回已有 reportId（幂等）
4. 若不存在：创建新 report

含义：
- 同城同年同文件 → 复用
- 同城同年不同文件 → 新建（允许多个版本）
- 同城不同年同文件 → 新建
```

---

#### 修正 3：API 示例（第 4.1 章）

**新增 409 响应示例**：
```json
响应（409 Conflict - 幂等）：
{
  "code": "REPORT_ALREADY_EXISTS",
  "message": "Report for this region/year/file already exists",
  "reportId": 1001,
  "jobId": 2001,
  "status": "succeeded"
}
```

---

#### 修正 4：API 示例（第 4.6 章）

**当前**：
```json
{
  "id": 3001,
  "code": "huangpu",
  ...
},
{
  "id": 3001,  // ← 错误
  "code": "hongkou",
  ...
}
```

**改为**：
```json
{
  "id": 1,
  "code": "huangpu",
  ...
},
{
  "id": 2,
  "code": "hongkou",
  ...
}
```

---

#### 修正 5：Prompt 管理（第 5.4 章）

**当前**：
```
- Prompt 文本以文件形式随代码版本管理，默认路径：`prompts/`
  - 示例：`prompts/v1.md`、`prompts/v2.md`
```

**改为**：
```
- Prompt 文本以文件形式随代码版本管理，默认路径：`src/prompts/`
- 目录结构：
  ```
  src/prompts/
    ├─ v1/
    │  ├─ system.txt
    │  ├─ user.txt
    │  └─ schema.json
    ├─ v2/
    │  ├─ system.txt
    │  ├─ user.txt
    │  └─ schema.json
    └─ README.md
  ```
- 运行时加载：
  ```typescript
  const promptDir = `src/prompts/${process.env.PROMPT_VERSION}`;
  const systemPrompt = fs.readFileSync(`${promptDir}/system.txt`, 'utf-8');
  const userPrompt = fs.readFileSync(`${promptDir}/user.txt`, 'utf-8');
  const schema = JSON.parse(fs.readFileSync(`${promptDir}/schema.json`, 'utf-8'));
  ```
```

---

#### 修正 6：错误码定义（第 4.8 章）

**当前**：
```
| REPORT_ALREADY_EXISTS | 409 | 文件已存在（幂等） |
```

**改为**：
```
| REPORT_ALREADY_EXISTS | 409 | 同城同年同文件已存在（幂等，返回已有 reportId） |
```

---

### ACCEPTANCE_LLM_INGESTION.md

#### 修正 7：启动命令（第 4.1 章）

**新增验证步骤**：
```bash
# 6) 验证后端启动成功
curl http://localhost:3000/api/health
# 预期响应：{"status":"ok","database":"connected"}

# 7) 启动前端（如前端独立目录）
cd frontend
npm install
npm start
# 前端应在 http://localhost:3000 或 http://localhost:3001 启动
```

---

#### 修正 8：数据库选择（第 4.0 章）

**当前**：
```
**Phase 1 采用 PostgreSQL**（推荐生产）
```

**改为**：
```
**Phase 1 采用 PostgreSQL**（生产就绪）

本地开发可选 SQLite（快速验证）：
- 优点：无需安装 PostgreSQL，快速启动
- 缺点：不支持并发，不适合生产

生产环境必须使用 PostgreSQL：
- 支持并发、事务、复杂查询
- 支持 JSONB 类型
```

---

### CORRECTIONS_SUMMARY.md

#### 修正 9：更新第 2 项

**当前**：
```
使用组合唯一键：`UNIQUE(region_id, year, file_hash)`
```

**改为**：
```
使用三元组唯一键：`UNIQUE(region_id, year, file_hash)`
含义：同城同年同文件只有一份 report，支持同城同年多个不同文件
```

---

#### 修正 10：更新第 5 项

**当前**：
```
1. **Prompt 文件结构**
   ```
   src/prompts/
     ├─ v1/
```

**改为**：
```
1. **Prompt 文件结构**（与 HLD 第 5.4 章一致）
   ```
   src/prompts/
     ├─ v1/
     │  ├─ system.txt
     │  ├─ user.txt
     │  └─ schema.json
     ├─ v2/
     │  ├─ system.txt
     │  ├─ user.txt
     │  └─ schema.json
     └─ README.md
   ```
```

---

## ✅ 修正完成检查清单

修正完成后，请逐一验证：

- [ ] HLD 第 3.1 章：reports 表使用 `UNIQUE(region_id, year, file_hash)`
- [ ] HLD 第 5.4 章：幂等策略说明三元组逻辑
- [ ] HLD 第 4.1 章：API 示例包含 409 响应
- [ ] HLD 第 4.6 章：城市列表示例中 ID 不重复
- [ ] HLD 第 4.8 章：错误码描述准确
- [ ] HLD 第 5.4 章：Prompt 管理使用目录结构
- [ ] ACCEPTANCE 第 4.0 章：数据库选择说明清晰
- [ ] ACCEPTANCE 第 4.1 章：启动命令包含验证步骤
- [ ] CORRECTIONS_SUMMARY：所有修正项与 HLD 一致
- [ ] 所有文档中的 ID 示例一致（使用小整数如 1, 2, 1001 等）

---

## 🚀 修正后的验证步骤

1. **文档一致性检查**
   ```bash
   # 检查所有文档中的关键术语是否一致
   grep -r "UNIQUE(region_id, year" .kiro/steering/
   grep -r "REPORT_ALREADY_EXISTS" .kiro/steering/
   grep -r "src/prompts/" .kiro/steering/
   ```

2. **SQL 语法检查**
   ```bash
   # 确保 PostgreSQL 和 SQLite SQL 都能运行
   # PostgreSQL
   psql -f migrations/001_init_schema.sql
   
   # SQLite
   sqlite3 data.db < migrations/001_init_schema.sql
   ```

3. **API 示例验证**
   ```bash
   # 按 ACCEPTANCE 第 4.2 章执行完整数据流测试
   # 验证 409 响应是否正确返回
   ```

---

## 📞 如有疑问

如果修正过程中有疑问，请参考：
- DOCUMENT_REVIEW_ISSUES.md（详细问题分析）
- 各文档的原始版本（git history）
