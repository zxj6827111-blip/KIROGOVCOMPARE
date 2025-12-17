# 文档审查报告：发现的矛盾与不合理之处

## 🔴 严重矛盾（必须立即修正）

### 1. 数据库选择矛盾

**HLD 中的说法**：
```
第 3.1 章：
"-- Phase 1 默认采用 SQLite（生产如需 PostgreSQL，可按注释替换类型/默认值）"
```

**CORRECTIONS_SUMMARY 中的说法**：
```
## 3. ✅ 选定 Phase 1 的数据库与迁移语法

**Phase 1 采用 PostgreSQL**（推荐生产）
```

**ACCEPTANCE 中的说法**：
```
第 4.0 章：
"**Phase 1 采用 PostgreSQL**（推荐生产）"
```

**问题**：
- HLD 说 Phase 1 默认 SQLite，生产可选 PostgreSQL
- CORRECTIONS 和 ACCEPTANCE 说 Phase 1 采用 PostgreSQL
- **这是直接矛盾**

**建议**：
- 明确决策：Phase 1 到底用什么？
  - 选项 A：SQLite（快速原型）→ Phase 2 迁移 PostgreSQL
  - 选项 B：PostgreSQL（生产就绪）→ 本地开发用 SQLite

---

### 2. 幂等策略矛盾

**HLD 第 5.4 章（旧内容）**：
```
选项 A（推荐）：复用已有版本
1. 计算上传 PDF 的 SHA256 hash
2. 查询 reports 表，WHERE file_hash = ?
3. 若存在：返回已有 report ID
```

**HLD 第 3.1 章（新内容）**：
```sql
UNIQUE(region_id, year)  -- 业务唯一：同一城市同一年仅一份"逻辑报告"
```

**问题**：
- 旧内容说按 `file_hash` 全局唯一判断幂等
- 新内容说按 `(region_id, year)` 组合唯一
- **这两个策略完全不同**

**具体冲突**：
- 旧策略：同一文件在不同城市/年份上传 → 复用同一 report
- 新策略：同一城市同一年只能有一份 report，不同文件会冲突

**建议**：
- 明确选择一种策略
- 推荐：`UNIQUE(region_id, year, file_hash)` 三元组
  - 同城同年同文件 → 复用
  - 同城同年不同文件 → 新建
  - 同城不同年同文件 → 新建

---

### 3. 数据库表字段矛盾

**HLD 中的 reports 表**：
```sql
UNIQUE(region_id, year)  -- 业务唯一
```

**但 CORRECTIONS_SUMMARY 说**：
```
使用组合唯一键：`UNIQUE(region_id, year, file_hash)`
```

**问题**：
- 如果是 `UNIQUE(region_id, year)`，那么同城同年不能上传两个不同的 PDF
- 如果是 `UNIQUE(region_id, year, file_hash)`，那么同城同年可以上传多个不同的 PDF

**这影响业务逻辑**：
- 一个城市一年只有一份官方年报吗？还是可能有多个版本？

**建议**：
- 明确业务需求
- 如果一年一份 → `UNIQUE(region_id, year)`
- 如果一年多份 → `UNIQUE(region_id, year, file_hash)` 或无唯一约束

---

### 4. 数据库表字段缺失

**HLD 中的 reports 表新增字段**：
```sql
storage_path TEXT NOT NULL,             -- 本地路径或对象存储 URL
text_path TEXT,                         -- 可选：全文文本落盘路径
```

**但 CORRECTIONS_SUMMARY 没有提及这些字段**

**问题**：
- 这些字段是什么时候加的？
- 为什么需要 `text_path`？
- 这与"前端上传全文"的设计是否一致？

**建议**：
- 明确这些字段的用途
- 如果前端上传全文，后端是否需要落盘？
- 如果需要，存储策略是什么？

---

### 5. Prompt 管理位置矛盾

**HLD 第 5.4 章（新增）**：
```
### 5.4 Prompt 资产管理（必须可审计）

- Prompt 文本以文件形式随代码版本管理，默认路径：`prompts/`
  - 示例：`prompts/v1.md`、`prompts/v2.md`
```

**但 CORRECTIONS_SUMMARY 第 5 项说**：
```
1. **Prompt 文件结构**
   ```
   src/prompts/
     ├─ v1/
     │  ├─ system.txt
     │  ├─ user.txt
     │  └─ schema.json
```

**问题**：
- 路径不一致：`prompts/` vs `src/prompts/`
- 文件结构不一致：`v1.md` vs `v1/system.txt + user.txt + schema.json`

**建议**：
- 统一路径和文件结构
- 推荐：`src/prompts/v1/` 目录结构（便于版本管理）

---

## 🟡 中等问题（需要澄清）

### 6. API 响应示例中的 ID 重复

**HLD 第 4.6 章**：
```json
{
  "data": [
    {
      "id": 3001,
      "code": "huangpu",
      ...
    },
    {
      "id": 3001,  // ← 重复了！应该是 3002
      "code": "hongkou",
      ...
    }
  ]
}
```

**问题**：
- 两个不同的城市有相同的 ID
- 这是复制粘贴错误

**建议**：
- 修正为 `id: 3002`

---

### 7. 数据库表中的 jobs 表字段过多

**HLD 中的 jobs 表**：
```sql
type TEXT NOT NULL,                   -- parse/reparse
progress INTEGER NOT NULL DEFAULT 0,  -- 0-100
payload_json TEXT,                    -- JSON 字符串
error_code TEXT,
error_message TEXT,
```

**问题**：
- `type` 字段在 ACCEPTANCE 中没有提及
- `progress` 字段在 API 响应中没有返回
- `payload_json` 字段存储全文，可能很大（超过 SQLite 限制）

**建议**：
- 明确这些字段是否必需
- 如果存储全文，考虑使用外部存储（如 S3）而不是数据库

---

### 8. 错误码定义不完整

**HLD 第 4.8 章**：
```
| REPORT_ALREADY_EXISTS | 409 | 文件已存在（幂等） |
```

**问题**：
- 错误码说"文件已存在"，但没有说明是什么情况下返回
- 根据新的幂等策略，应该说"同城同年同文件已存在"

**建议**：
- 更新错误码描述
- 在 API 响应示例中展示 409 的完整响应体

---

## 🟢 轻微问题（建议改进）

### 9. 文档中的 PostgreSQL 语法被注释掉了

**HLD 第 3.1 章**：
```sql
-- Phase 1 默认采用 SQLite（生产如需 PostgreSQL，可按注释替换类型/默认值）
```

**问题**：
- 没有提供 PostgreSQL 的完整 SQL
- 开发者需要自己转换

**建议**：
- 提供两套完整的 SQL（PostgreSQL + SQLite）
- 或提供迁移工具自动转换

---

### 10. ACCEPTANCE 中的启动命令不完整

**ACCEPTANCE 第 4.1 章**：
```bash
npm run dev:api
# 若仓库提供单一入口脚本，也可使用：npm run dev
```

**问题**：
- 没有说明前端如何启动
- 没有说明如何验证启动成功

**建议**：
- 补充前端启动命令
- 补充验证命令（如 `curl http://localhost:3000/api/health`）

---

## 📋 修正优先级

| 优先级 | 问题 | 影响 |
|--------|------|------|
| 🔴 P0 | 数据库选择矛盾 | 影响整个项目方向 |
| 🔴 P0 | 幂等策略矛盾 | 影响数据库设计和 API 逻辑 |
| 🔴 P0 | 数据库表字段矛盾 | 影响数据库迁移脚本 |
| 🟡 P1 | Prompt 管理位置矛盾 | 影响文件组织结构 |
| 🟡 P1 | API 响应示例错误 | 影响前端开发 |
| 🟡 P1 | 错误码定义不完整 | 影响错误处理 |
| 🟢 P2 | PostgreSQL 语法缺失 | 影响生产部署 |
| 🟢 P2 | 启动命令不完整 | 影响测试流程 |

---

## 建议的修正方案

### 方案 A：SQLite First（快速原型）
```
Phase 1：SQLite（本地开发 + 测试）
Phase 2：迁移到 PostgreSQL（生产就绪）
```

### 方案 B：PostgreSQL First（生产就绪）
```
Phase 1：PostgreSQL（生产就绪）
本地开发：SQLite（可选）
```

**推荐**：方案 B（PostgreSQL First）
- 理由：避免后期迁移的复杂性
- 本地开发可用 Docker Compose 快速启动 PostgreSQL

---

## 下一步行动

1. **立即修正** P0 问题（数据库选择、幂等策略、表字段）
2. **澄清** 业务需求（一年一份报告还是多份？）
3. **统一** 所有文档中的术语和设计决策
4. **补充** 缺失的 SQL 和启动命令
5. **验证** 文档中的所有示例代码是否可运行
