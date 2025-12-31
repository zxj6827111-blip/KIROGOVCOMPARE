# 异步任务系统改造实现计划

目标：将上传解析流程从“同步阻塞等待 AI 完成”改造成“异步任务制”，并新增「任务中心（按地区/年份/单位）」与「消息中心（站内通知）」。

关键约束（已定稿）：
- 同一（地区/年份/单位）重复上传：**以最新版本为准**，覆盖默认展示结果（保留历史版本追溯）
- 支持断电/重启恢复：任何 `running` 的任务重启后必须回滚 `queued` 并**从头重新解析**
- 两轮解析：第 1 轮 PRIMARY 模型；失败后第 2 轮改用 FALLBACK 模型；第 2 轮仍失败则最终失败并汇总原因
- 进度：固定 5 步，**中文展示**
- 第一阶段不做并发：Runner 串行一次只处理一个

---

## User Review Required（必须确认/注意）

> [!IMPORTANT]
> **唯一约束变更**：`reports` 表唯一约束从 `UNIQUE(region_id, year)` 改为 `UNIQUE(region_id, year, unit_name)`。
>
> 迁移前必须清洗：
> - 将 `unit_name IS NULL` 统一设为 `''`
> - 统一 `TRIM(unit_name)`，避免“看似相同但实际不同”
> - 检查重复：确保无 `(region_id, year, unit_name)` 重复记录

> [!WARNING]
> **Breaking Change**：所有“按地区+年份定位报告”的查询/接口必须同时考虑 `unit_name`，否则会命中错误或命中不唯一。

---

## Proposed Changes

## 1. Database Layer

### 1.1 [NEW] migrations/sqlite/008_async_jobs_schema.sql

#### 1) 数据清洗（迁移前执行）
```sql
UPDATE reports SET unit_name = '' WHERE unit_name IS NULL;
UPDATE reports SET unit_name = TRIM(unit_name);

-- 检查重复（应返回0行）
SELECT region_id, year, unit_name, COUNT(*) AS cnt
FROM reports
GROUP BY region_id, year, unit_name
HAVING cnt > 1;
```

#### 2) 重建 reports 表并添加新 UNIQUE（SQLite）
> SQLite 不支持直接 ALTER UNIQUE 约束：采用“新表→拷贝→替换”。
> 注意：若开启外键约束，需临时关闭再恢复。

```sql
PRAGMA foreign_keys=OFF;

-- Step 1: 新表（带新 UNIQUE）
CREATE TABLE reports_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  year INTEGER NOT NULL,
  unit_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(region_id, year, unit_name)
);

-- Step 2: 拷贝数据（保留原 id）
INSERT INTO reports_new (id, region_id, year, unit_name, created_at, updated_at)
SELECT id, region_id, year, COALESCE(unit_name, ''), created_at, updated_at
FROM reports;

-- Step 3: 替换
DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;

-- Step 4: 索引（按需）
CREATE INDEX IF NOT EXISTS idx_reports_region_year_unit ON reports(region_id, year, unit_name);
CREATE INDEX IF NOT EXISTS idx_reports_region_year ON reports(region_id, year);

PRAGMA foreign_keys=ON;
```

#### 3) 扩展 jobs 表（中文进度 + 两轮重试 + 追溯字段）
```sql
ALTER TABLE jobs ADD COLUMN step_code TEXT DEFAULT 'QUEUED';
ALTER TABLE jobs ADD COLUMN step_name TEXT DEFAULT '等待处理';
ALTER TABLE jobs ADD COLUMN attempt INTEGER DEFAULT 1;        -- 展示用途：attempt = retry_count + 1
ALTER TABLE jobs ADD COLUMN provider TEXT;
ALTER TABLE jobs ADD COLUMN model TEXT;
ALTER TABLE jobs ADD COLUMN created_by INTEGER;

-- 统一重试语义：max_retries=1 表示“允许重试1次”，总尝试 2 次
UPDATE jobs SET max_retries = 1 WHERE max_retries != 1;

-- attempt 与 retry_count 一致性回填
UPDATE jobs SET attempt = retry_count + 1;
```

#### 4) 创建 notifications 表（消息中心）
```sql
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'upload_complete',
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT,
  related_job_id INTEGER REFERENCES jobs(id),
  related_version_id INTEGER REFERENCES report_versions(id),
  created_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at);
```

---

## 2. Backend - Configuration

### 2.1 [MODIFY] .env.example

采用 provider + model 分开配置（与现有风格一致）：

```diff
LLM_PROVIDER=gemini
LLM_MODEL=gemini-1.5-pro

+LLM_FALLBACK_PROVIDER=glm
+LLM_FALLBACK_MODEL=glm-4-plus
```

---

## 3. Backend - Upload API（“最新为准覆盖”必须落在这里）

### 3.1 [MODIFY] POST /api/reports（立即返回，不阻塞）

**行为必须固定：**
1) 以 `(region_id, year, unit_name)` 定位/创建 `reports` 记录  
2) 每次上传都创建一条新的 `report_versions`  
3) 覆盖“最新”：同一 report 下  
   - 先将旧版本 `is_active=0`
   - 新版本 `is_active=1`
4) 为新版本创建解析链路所需 jobs（至少 `parse`，如保留 `checks` 则一并创建为 queued）
5) **立即返回**（严禁等待 AI）：返回必须包含 `report_id`、`version_id`、以及（可选）主 job_id

**返回示例：**
```json
{
  "report_id": 10,
  "version_id": 120,
  "job_id": 555
}
```

---

## 4. Backend - Job Runner（串行 + 两轮换模型 + 重启恢复）

### 4.1 [MODIFY] src/services/LlmJobRunner.ts

#### 4.1.1 串行处理（不做并发）
Runner 每次只取 1 条 queued job（现有串行轮询可保留）。

#### 4.1.2 启动恢复（断电/重启必须可恢复）
服务启动时：
- 将所有 `status='running'` 的 jobs 回滚为 `queued`
- 同步重置显示字段，避免“卡在 50%”的错觉：
  - `progress=0`
  - `step_code='QUEUED'`
  - `step_name='等待处理'`
  - `error_code/error_message` 可选择清空（推荐清空）

#### 4.1.3 两轮换模型重试（max_retries=1）
统一用现有 `retry_count/max_retries`，attempt 仅展示用途：
- `attempt = retry_count + 1`（落库或查询时计算均可，但需一致）
- attempt=1：使用 `LLM_PROVIDER/LLM_MODEL`
- 第一次失败：`retry_count++`，重新入队 queued
- attempt=2：使用 `LLM_FALLBACK_PROVIDER/LLM_FALLBACK_MODEL`
- attempt=2 仍失败：最终 failed，`error_message` 必须包含“已更换模型重试仍失败”

#### 4.1.4 5步中文进度（固定）
| step_code | step_name | progress |
|---|---|---|
| RECEIVED | 已接收并保存文件 | 10 |
| ENQUEUED | 已入库并创建解析任务 | 20 |
| PARSING | AI 解析中 | 50 |
| POSTPROCESS | 结果校验与入库 | 80 |
| DONE | 完成 | 100 |

> 注：`progress` 仍使用 jobs 表原有字段；`step_code/step_name` 为新增字段。

#### 4.1.5 通知生成（只在“全流程最终结束”后）
仅当该上传版本（version_id）的全流程进入最终态（成功或二轮仍失败）时生成通知：
- 若内部保留 parse + checks：要求 parse 与 checks 都完成后再发
- 通知 content_json 必须包含：
  - uploaded_count（当前为 1）
  - success_count（0/1）
  - fail_list（失败则写：region/year/unit_name + reason）
  - task_link（前端任务详情链接，见下方统一 ID 语义）

---

## 5. Backend - Task Center API（按 version_id 聚合，ID 语义必须统一）

> 任务中心以“上传任务（=一个 report_version 全流程）”为粒度展示  
> 因此 API 与前端路由 **统一以 version_id 作为 :id**。

### 5.1 [NEW] src/routes/jobs.ts

| Method | Path | Description |
|---|---|---|
| GET | `/api/jobs` | 任务列表（按 version_id 聚合），支持 `?region_id=&year=&unit_name=&status=` |
| GET | `/api/jobs/:version_id` | 任务详情（该 version 聚合视图 + 子 job 列表可选） |
| POST | `/api/jobs/:version_id/retry` | 手动重试（仅最终 failed 可用；重置 retry_count/attempt 并回到 queued，从头跑两轮） |

#### 5.1.1 聚合状态定义（对外返回）
后端 jobs 真实状态：`queued/running/succeeded/failed`  
聚合对外状态建议返回：`queued/processing/succeeded/failed`

聚合规则（version_id 维度）：
- 任一子 job 为 `queued` → 整体 `queued`
- 任一子 job 为 `running` → 整体 `processing`
- 全部 `succeeded` → 整体 `succeeded`
- 存在 `failed` 且无 `queued/running` → 整体 `failed`

#### 5.1.2 详情返回建议字段
- version_id（主键）
- report_id、region_id、year、unit_name
- aggregated_status、progress、step_code、step_name
- attempt（1/2）、provider/model（当前轮）
- error_code/error_message（最终失败时）
- updated_at

> `progress/step_name` 推荐从当前“正在跑的子 job”取；若都完成则取 DONE/100。

---

## 6. Backend - Notifications API（消息中心）

### 6.1 [NEW] src/routes/notifications.ts

| Method | Path | Description |
|---|---|---|
| GET | `/api/notifications` | 通知列表，支持 `?unread_only=1` |
| POST | `/api/notifications/:id/read` | 标记已读 |
| POST | `/api/notifications/read-all` | 全部已读（可选） |

通知 content_json 示例（统一 task_link 使用 version_id）：
```json
{
  "uploaded_count": 1,
  "success_count": 1,
  "fail_list": [],
  "task_link": "/jobs/120"
}
```

---

## 7. Frontend - Upload Page（上传后可关闭/离开）

### 7.1 [MODIFY] frontend/src/components/UploadReport.js

必须改成：
- 上传成功拿到 `version_id` 后：
  - Toast：“任务已创建，可关闭页面”
  - 自动跳转：`/jobs/:versionId`（注意：是 versionId，不是 jobId）
- 移除在上传页内持续轮询等待完成的阻塞交互

---

## 8. Frontend - Task Center（按 version 聚合）

### 8.1 [NEW] frontend/src/components/JobCenter.js
- 路由：`/jobs`
- 列表列：地区/年份/单位、聚合状态、进度、步骤名、更新时间、attempt、模型
- 筛选：状态、地区、年份、单位
- **不显示 parse/checks 子 job**

### 8.2 [NEW] frontend/src/components/JobDetail.js
- 路由：`/jobs/:versionId`
- 展示：
  - 5步中文进度条
  - 聚合状态、attempt（1/2）、当前轮模型信息
  - 失败原因（最终失败）
  - 手动重试按钮（仅最终 failed）
- 轮询：聚合状态为 queued/processing 时每 3 秒刷新；完成后停止

---

## 9. Frontend - Notification Center（消息中心）

### 9.1 [NEW] frontend/src/components/NotificationCenter.js
- 展示未读通知，支持标记已读
- 点击通知跳转 task_link（/jobs/:versionId）

---

## 10. Verification（验收）

必须覆盖的验收用例：
1) 上传接口立即返回（不等待AI）
2) 离开/关闭上传页后，后台继续解析
3) 断电/重启：running 任务回滚 queued 并从头解析，不会卡死
4) 两轮换模型重试：第1轮失败后第2轮使用 fallback；二轮仍失败则最终失败并汇总
5) 任务中心按地区/年份/单位展示聚合进度（以 version_id 为粒度）
6) 全流程结束后生成站内通知；下次打开前端在消息中心可见统计与失败清单
