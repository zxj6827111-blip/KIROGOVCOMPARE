# 工程二：本地标准材料包导入（structured package import）

## 能力

- `POST /api/reports/structured-import`：上传 `.kirogov.zip`，**不调用 LLM**。
- Worker `jobs.kind = structured_import`：重算哈希 → 写入 `parsed_json` → **enqueue `materialize`**。
- 现有 `processMaterializeJob` 在物化成功后 **enqueue `checks`**（与普通 AI 解析后链路一致）。
- `structured_import` 任务本身 **succeeded 只表示导入写库完成**，不等于整条流水线结束。
- 普通 `POST /api/reports` 仍走 AI 解析，行为不变。

## 材料包格式

```
package.kirogov.zip
├── source.pdf
├── source.md
└── source.json   # schema_version=1.0 + parsed_json
```

Schema：`src/schemas/kirogov-package/1.0/source.schema.json`

## 任务状态语义

| 任务 kind | 含义 |
|-----------|------|
| `structured_import` | 校验材料包、落盘 artifact、写入 `parsed_json`（无 AI） |
| `materialize` | 结构化入库事实表 |
| `checks` | 一致性 / 问题清单 |

- `jobPipeline` 将 `structured_import` **映射为 parse 阶段**。
- 仅当 **import + materialize + checks** 均成功时，管道 `all_core_succeeded` 为 true。
- 任务抽屉对 `structured_import` job 使用 **version 管道聚合**（`aggregateStructuredImportTaskDisplay`）：import 已成功但下游未完成时显示 **processing**，不会提前“整链完成”。

## AI 重新解析守卫（P1）

- `ingestion_mode = 'structured_import'` 的版本 **禁止进入 AI 解析队列**。
- 守卫位于服务层共享入队函数 `enqueueReportParseJob`
  （`src/services/ParseEnqueueService.ts`，`routes/reports.ts` 向后兼容再导出），
  单报告 `POST /reports/:id/parse` 与批量 `POST /reports/batch-parse` 全部经过它：
  - 单报告：HTTP 422 + `STRUCTURED_VERSION_AI_REPARSE_FORBIDDEN`，不建任务、不改 parsed_json。
  - 批量：结构化版本记为 `skipped`（响应含 `skipped` / `skipped_items[]`），不拖垮整批。

## 下游失败恢复

- `POST /jobs/:version_id/retry`（`manage_jobs` 权限）：
  - parse 阶段（parse / structured_import）已成功、materialize 失败或缺失 → 只重排 `materialize`；
  - materialize 成功、checks 失败或缺失 → 只重排 `checks`；
  - 全部成功 → 返回“无需重试”；
  - parse 阶段本身失败 → 保持原有“全失败重建”行为。
- 重新上传同一材料包并复用已成功导入任务时，会自动补齐失败的下游任务
  （`ensureStructuredImportJob` → `recoverVersionDownstream`）。
- 恢复通道 **不会** 重跑 structured_import，也 **不会** 创建 AI parse 任务；
  活跃任务唯一索引 + 23505 复查保证并发下不出现双活任务。
- 实现：`src/services/PipelineRecoveryService.ts`。

## 前端

上传页「单文件上传」中选择：

- 普通 PDF / HTML / 文本 → `/api/reports`（需 AI 模型）
- 本地解析包（.kirogov.zip）→ `/api/reports/structured-import`（隐藏模型选择）

拖入 `.kirogov.zip` 会自动切换到材料包模式；裸 `.zip` 会被拒绝。

## 数据库

- `report_versions.ingestion_mode`：`ai_parse` | `structured_import`（旧数据默认 `ai_parse`）
- `report_versions.package_sha256` + 唯一 `(report_id, package_sha256)`
- `report_version_artifacts`：package / pdf / md / json
- 迁移：`0002_structured_package_import`（`structuredPackageSchema.ts` 单源 DDL）
  - **`reversible: false`**（删除列/表会毁掉 artifact 元数据并错误回标 `ai_parse`，不做破坏性 down）
- 活跃 job 部分唯一索引：每 version 在 `queued|running` 下最多一条 `structured_import` / `materialize` / `checks`

## 发布与一致性

1. 解压校验到 **staging** 目录
2. 事务内写 version / artifacts / job
3. **`publishStagingDir` 整目录 rename 到最终路径（先于 COMMIT）**
4. `COMMIT`
5. 若已发布但 commit 失败且无 `package_sha256` 引用 → `cleanupOrphanPackageDir` 清理 orphan

Worker 领取 job 时磁盘文件已可见；`executeImportJob` 会再次校验路径与四文件哈希。

## 本地验证

```bash
# 类型
npx tsc --noEmit

# 单元 / 策略
npx jest --runInBand --testPathPattern="structuredImport|structuredPackage|jobPipeline|publishAndTask|migrations"

# 隔离库 E2E（真实 claimNextJob + processJob 排水：import → materialize → checks）
npm run test:e2e:structured-import
```

- 自动创建并删除库 `kirogov_structured_e2e`（与 `.env` 中 `DB_NAME` 隔离，绝不写入生产库名）
- 自动创建并删除独立数据目录 `os.tmpdir()/kirogov-structured-e2e-*`（通过环境变量
  `KIROGOV_DATA_DIR` 覆盖 `DATA_DIR`），上传/staging/发布包全部落在临时目录，
  **不写入项目 `data/uploads`**；结束时（含失败路径）递归删除
- E2E 会将 `createLlmProvider` 替换为计数并抛错的桩，最终断言 LLM 构造次数为 0
- E2E 覆盖下游恢复：materialize 失败 → 并发恢复请求收敛为单任务；checks 失败 →
  重新上传同包自动补队；全部成功 → nothing_to_retry
- 保留库：`E2E_KEEP_DB=1 npm run test:e2e:structured-import`

夹具生成（非产品）：

```bash
npx ts-node scripts/generate-structured-import-fixtures.ts
```

## 安全要点

- ZIP Slip / 文件数 / 大小 / 压缩比 / 仅根目录三文件
- PDF 魔术 `%PDF-`
- Worker 再次校验 ZIP/PDF/MD/JSON 哈希
- 失败只删 staging；最终目录仅在无 DB 引用时作为 orphan 清理
