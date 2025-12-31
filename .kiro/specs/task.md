# 异步任务系统改造任务清单

## 核心目标
将上传解析流程从“同步阻塞等待AI完成”改造成“异步任务制”，新增任务中心+消息中心（站内通知）。

统一约定（必须一致）：
- 任务中心展示粒度：**report_version（version_id）** 为主键聚合
- 前端路由：`/jobs/:versionId`
- 后端详情接口：`GET /api/jobs/:version_id`
- 两轮重试：max_retries=1（总尝试2次），第二轮使用 FALLBACK 模型

---

## Phase 1: Database Schema Changes
- [ ] 数据清洗：`unit_name` NULL → `''`，并执行 `TRIM(unit_name)`  
- [ ] 修改 `reports` 表唯一约束：`UNIQUE(region_id, year)` → `UNIQUE(region_id, year, unit_name)`（SQLite：新表→拷贝→替换）
- [ ] 扩展 `jobs` 表字段：`step_code`, `step_name`, `attempt`, `provider`, `model`, `created_by`
- [ ] 统一重试语义：更新 `max_retries=1`；回填 `attempt = retry_count + 1`
- [ ] 创建 `notifications` 表

## Phase 2: Backend - Upload Behavior（最新覆盖）
- [ ] `POST /api/reports`：每次上传新建 `report_version`
- [ ] 覆盖“最新”：同一 report 下旧版本 `is_active=0`，新版本 `is_active=1`
- [ ] 上传后创建解析 jobs（parse + checks 如保留），并立即返回 `{report_id, version_id, job_id}`（不等待AI）

## Phase 3: Backend - Job Runner Improvements
- [ ] 实现两轮换模型逻辑：attempt=1 用 PRIMARY；失败后 attempt=2 用 FALLBACK；二轮仍失败最终 failed
- [ ] 实现服务启动恢复：`running` → `queued`，并重置 `progress/step/error`（避免卡在中间进度）
- [ ] 实现 5 步中文进度更新（step_code + step_name + progress）
- [ ] 添加 `LLM_FALLBACK_PROVIDER` / `LLM_FALLBACK_MODEL` 配置

## Phase 4: Backend - Task Center API（按 version 聚合）
- [ ] `GET /api/jobs`：按 `version_id` 聚合的任务列表（支持 region_id/year/unit_name/status 筛选）
- [ ] `GET /api/jobs/:version_id`：聚合任务详情（含 5 步进度、attempt、模型、错误原因）
- [ ] `POST /api/jobs/:version_id/retry`：最终 failed 时允许手动重试（重置 retry_count/attempt，回到 queued）

## Phase 5: Backend - Notification Generation
- [ ] 仅在“该 version 全流程最终结束（含二轮重试）”时生成通知
- [ ] 通知结构：uploaded_count, success_count, fail_list, task_link（/jobs/:versionId）

## Phase 6: Frontend - Upload Page Changes
- [ ] 上传成功后 Toast 提示“任务已创建，可关闭页面”
- [ ] 上传成功后自动跳转到 `/jobs/:versionId`（不是 jobId）
- [ ] 移除上传页阻塞等待逻辑

## Phase 7: Frontend - Task Center (New)
- [ ] 创建 `/jobs` 任务列表页（按地区/年份/单位展示聚合任务）
- [ ] 创建 `/jobs/:versionId` 任务详情页（5 步中文进度条、attempt、模型、失败原因）
- [ ] 添加侧边栏入口
- [ ] 实现筛选：状态、地区、年份、单位
- [ ] 轮询策略：queued/processing 每 3 秒轮询；完成后停止

## Phase 8: Frontend - Notification Center (New)
- [ ] 创建消息中心入口
- [ ] 展示未读通知列表，支持标记已读
- [ ] 点击通知跳转 `task_link`

## Phase 9: Verification（验收）
- [ ] 上传立即返回（不阻塞）
- [ ] 关闭页面后后台继续解析
- [ ] 重启恢复：running → queued，并从头解析不卡死
- [ ] 两轮换模型重试正确执行
- [ ] 任务中心聚合展示正确（version 粒度）
- [ ] 通知生成与消息中心展示正确
