# 工程二验收报告：标准结构化材料包导入（structured package import）

## 1. 验收日期

2026-07-26

## 2. 代码基线

- 工程二合并 main commit SHA：`f074607a58563dc648c0182e3b25fd5991c40e94`（PR #142，merge commit）
- 验收期间发现 1 个 P1（见 §18），修复与本报告随修复 PR 一并入库（fix/storage-path-data-dir-resolution 分支）。

## 3. PR 编号

- 工程二功能：PR #142（feat: add secure structured package import pipeline）
- 验收 P1 修复 + 本报告：见修复 PR（fix: resolve storage paths via DATA_DIR override）

## 4. 迁移版本

- `0001_legacy_llm_idempotent_schema`
- `0002_structured_package_import`（结构化材料包列与 artifacts 表，run-on-every-start，幂等）

迁移验证（隔离库 `kirogov_acceptance`，全新空库从零初始化）：

- 首次执行：0001、0002 均 `succeeded`；重复执行：均幂等（run-on-every-start 重执行、账目不重复）。
- `report_versions.ingestion_mode`：存在，NOT NULL，默认 `'ai_parse'`（旧数据默认 ai_parse）。
- `report_versions.package_sha256`：存在（可空）。
- `report_version_artifacts`：存在；CHECK 约束 `chk_report_version_artifacts_type` 限定 4 类
  （source_package / source_pdf / source_markdown / source_json）；级联删除外键。
- 唯一索引：`uq_report_versions_package_report (report_id, package_sha256) WHERE package_sha256 IS NOT NULL`；
  `uq_jobs_version_structured_import_active` / `uq_jobs_version_materialize_active` / `uq_jobs_version_checks_active`
  （queued/running 局部唯一，防双活）。

## 5. 环境信息

| 项 | 值 |
|---|---|
| 平台 | Windows 11，Node 24，PostgreSQL localhost:5432，Redis 未用于验收链路（限流用 memory store） |
| 隔离数据库 | `kirogov_acceptance`（验收后已 DROP；真实库 `gov_report_diff_cloud_restore` 全程未连接） |
| 隔离 DATA_DIR | `KIROGOV_DATA_DIR` 指向会话级临时目录（验收后已删除） |
| AI 配置 | `OPENAI_API_KEY` = 空字符串；`OPENAI_BASE_URL` = `http://127.0.0.1:9/v1`（不可达）；`VISION_REVIEW_ENABLED=false` |
| 后端 | `src/index-llm.ts`（含同进程 JobRunner worker，kinds 含 structured_import），127.0.0.1:18787 |
| 前端 | dev-server 127.0.0.1:3101，`/api` 代理到 18787（项目真实网关方式） |

## 6. 服务状态

- `/api/health` = 200 `{"status":"ok","database":"connected"}`
- 前端页面可访问、可登录（测试管理员 acceptadmin，权限 upload_reports 等）
- worker 正常领取隔离库任务（structured_import → materialize → checks 自动完成）

## 7. 合法材料包测试（前端真实上传）

前端「本地解析包上传（.kirogov.zip）」上传 `tests/fixtures/structured-import/valid-sample.kirogov.zip`：

- POST `/api/reports/structured-import` → **201**
- report_id=1，version_id=1，job_id=1
- package_sha256 = `42362fec0c3db93612529f75e21df99aefa7910637cf6f70102c30f74de14d35`
- ingestion_mode = `structured_import`；parse_run provider=`structured_import`，model=`none`，accepted，is_current
- 任务链：structured_import(1) → materialize(2) → checks(3) 全部 succeeded，0 重试
- 页面：任务抽屉显示「已完成 · 解析 · 入库 · 校验 已全部完成 · 100%」；报告详情可打开；
  「勾稽关系校验」标签页完整渲染 29 个待复核项（左右值、差额、字段路径、来源线索、确认/忽略操作）。
- 文件仅落盘隔离 DATA_DIR（package.kirogov.zip + source.pdf/md/json，4 文件）；正式 data/uploads 前后一致。

基线核对（与标准 fixture 基线完全一致）：

| 项 | 基线 | 实测 |
|---|---|---|
| artifact | 4 类 | 4（source_package 1692B / source_pdf 438B / source_markdown 59B / source_json 4216B）|
| 事实 | 71 | 71 |
| 表二 | 6 | 6 |
| 表三 | 50 | 50 |
| 表四 | 15 | 15 |
| checks | 35 | 35 |

（问题清单 29 条待复核，与 E2E 一致。页面截图受环境限制未能捕获——浏览器面板未在前台合成帧；以逐步 DOM 文本提取与网络请求记录作为等价证据。）

## 8. 非法材料包测试

全部经 `/api/reports/structured-import` 实测，全部 400 拒绝、错误码精确、无有效 report_version/job/parsed_json 产生、
`uploads/tmp` 与 `.staging` 零残留、响应不含堆栈/SQL/服务器绝对路径：

| 用例 | HTTP | code | 提示 |
|---|---|---|---|
| extra-file 包 | 400 | ZIP_EXTRA_FILES | 不允许的文件: extra.txt |
| PDF 哈希错误包 | 400 | PDF_HASH_MISMATCH | source.pdf 的 SHA256 与 source.json 声明不一致（含 declared/actual）|
| Schema 错误包 | 400 | SCHEMA_VALIDATION_FAILED | 缺少必填字段: schema_version |
| 路径穿越包 | 400 | ZIP_PATH_TRAVERSAL | ZIP 包含非法路径（../source.pdf）|
| 裸 .zip | 400 | ZIP_INVALID | only .kirogov.zip packages are accepted |
| 普通 PDF 误传 | 400 | ZIP_INVALID | 同上 |

另实测元数据校验：表单 year=2025 上传声明 2024 的包 → 400 `METADATA_YEAR_MISMATCH`。

备注（外观级）：裸 .zip/误传 PDF 的 multer 层拒绝消息为英文；前端 UI 层对同场景已有中文提示
（「⚠️ 本地解析包请使用 .kirogov.zip（普通上传不支持 zip）」，实测通过）。

## 9. 无 AI 测试

- 启动进程内 `OPENAI_API_KEY` 为空字符串（进程内断言 true）、`OPENAI_BASE_URL` 指向不可达地址。
- structured_import / materialize / checks / 恢复链路全部成功；后端日志零 LLM/provider/网络活动。
- 反证：普通 PDF 的 ai_parse 任务在同环境按既有策略重试 3 次后以 `openai_missing_api_key` 优雅失败——
  证明空 Token 生效、未读取真实凭据、AI 不可达完全不影响结构化链路。
- E2E 层 patch `createLlmProvider` 计数断言 = 0。

## 10–13. artifact / parsed_json / facts / checks 结果

- artifact：4/4 齐全，sha256 与 size 与包内文件一致（source_package sha = package_sha256）。
- parsed_json：非空，`_ingestion.mode='structured_import'`，sections=3。
- facts：71（表二 6 / 表三 50 / 表四 15）。
- checks：run succeeded，35 项，fingerprint 唯一 35/35；问题清单（open）29 条。

## 14. 幂等结果

同包重复上传：**201**，`reused_version=true`、`reused_job=true`，同一 version_id=1/job_id=1；
artifact 仍 4、facts 仍 71、checks 仍 35、问题清单不重复；无 500。

## 15. 并发结果

同包并发 2 请求（全新报告，region 2 / 2024）：一个创建（reused=false）、一个收敛复用（reused=true），
均 201、同一 version_id=2 / job_id=4；最终仅 1 个版本、1 个 structured_import 任务；链路自动完成（facts 71 / checks 35）。

## 16. AI 重新解析守卫

- 单报告：POST `/api/reports/1/parse` → **422** `STRUCTURED_VERSION_AI_REPARSE_FORBIDDEN`（中文提示明确）；
  parsed_json md5 前后一致、parse_runs 不变（1）、无 parse 任务产生、`_ingestion` 保留。
- 批量：POST `/api/reports/batch-parse` [structured(1), ai_parse(3)] → 200；
  requested=2 / submitted=1 / skipped=1 / failed=0；skipped_items 准确标注 report 1 与原因；ai_parse 正常入队。

## 17. 下游恢复

- R1 materialize 失败：并发 2 次重试 → 一次 requeue materialize(9)、另一次可解释 400（已有活跃任务），无双活；
  structured_import 未重跑；materialize 成功后自动续 checks(10)；facts 数量不变（6/50/15）。
- R2 checks 失败：重试仅 requeue checks(11)，不动 materialize/导入；items 35，fingerprint 幂等（35 唯一）。
- R3 全部成功：重试 → 200「Nothing to retry: pipeline already succeeded」，零新任务，数据不变。
- 全程无 parse 任务产生、无 LLM 调用。

## 18. 普通 PDF 回归

- 上传普通 PDF → 201；ingestion_mode=`ai_parse`；创建 parse 任务；仍走原模型选择（provider=openai，model=gpt-5.5）。
- structured 守卫不误拦普通 PDF；`.kirogov.zip` 进普通接口 → 400「仅支持 PDF、HTML、TXT 或 Markdown 文件」；
  普通 PDF 进 structured 接口 → 400 ZIP_INVALID（双向拒绝）。
- 任务中心正确展示两类任务（structured=成功/模型 none；ai_parse=失败原因清晰/模型 gpt-5.5）。
- **P1（联调发现并已修复）**：`SourceFileGuardService.resolveAbsoluteStoragePath` 对相对存储标签
  （`data/uploads/...`）仅按 PROJECT_ROOT 解析；当设置 `KIROGOV_DATA_DIR`（隔离验收/测试）时，
  写入与校验路径分叉 → 普通 PDF 上传 500（SOURCE_FILE_MISSING）。生产环境不受影响
  （无该变量时两路径恒等，这也是全量测试与 CI 未暴露的原因）。修复：`data/` 前缀优先按 DATA_DIR 映射、
  找不到再回落 PROJECT_ROOT/cwd（生产行为不变），并新增 `sourceFileGuardResolve.test.ts` 3 例回归。
  修复后普通 PDF 上传在隔离环境实测 201。

## 19. 前端验收

- 普通上传/本地解析包两种模式均存在，说明清晰（package 模式明示「不调用 AI」）。
- package 模式隐藏 AI 模型选择；accept 限定 `.kirogov.zip,application/zip`。
- 注入/拖入 `.kirogov.zip` 自动切换到 package 模式（实测）；裸 `.zip` 明确中文拒绝（实测）。
- 材料包模式选非 kirogov 文件有专门提示（代码路径核验）。
- 成功后任务抽屉展示进度并完成；失败时页面显示校验失败原因（实测非法包 → ❌ 提示）。
- 完成后可进入报告详情与问题清单。
- 无 OCR、本地 PDF 解析或工程三入口（「视觉复核」标签为既有功能，非新增）。
- 外观级备注：package 模式下拖拽区辅助文案仍显示「支持 PDF、HTML、TXT 或 Markdown 文件」（不影响行为）。

## 20. 全量测试结果（修复后最终复跑）

```text
TypeScript：0 errors
Jest：52 suites / 396 tests passed / 0 failed / 0 skipped
Backend build：passed
Frontend typecheck：passed
Frontend build：passed
Structured import E2E：passed（隔离库已 DROP、临时 DATA_DIR 已删除、LLM calls = 0）
control-chars（提交集）：0 BOM / 0 隐藏控制字符
git diff --check：passed
```

临时资源清理：`kirogov_acceptance` 已 DROP；隔离 DATA_DIR 已删除；
正式 data/uploads 验收前后逐项一致（4394 文件 / 536,676,005 字节）；真实数据库全程未连接。

## 21. 已知限制

1. main 的 CI `npm audit` 步骤因既有 brace-expansion 公告（GHSA-mh99-v99m-4gvg，40 high）持续红，
   属依赖治理任务，与工程二无关（PR #142 已取证）。
2. package 模式拖拽区辅助文案未随模式切换（外观级）。
3. multer 层两条拒绝消息为英文（UI 层已有中文提示，外观级）。
4. 最小 fixture 的报告详情「报告正文」区按设计显示空正文提示（数据性表现，非缺陷）。
5. 页面截图因浏览器面板未前台合成而未捕获，以 DOM 文本提取+网络记录作为等价证据。

## 22. 结论：是否允许进入工程三

**允许（ready_for_phase_3 = true）。** 18 条封板标准全部满足；唯一联调 P1 已修复并回归。
