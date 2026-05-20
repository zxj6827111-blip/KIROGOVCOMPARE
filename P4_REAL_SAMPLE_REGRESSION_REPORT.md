# P4-1 真实样本全链路回归报告

## 1. 验证时间

- 验证时间：2026-05-20 22:34:11 +08:00
- 当前分支：`codex/p4-real-sample-regression`
- 当前 main commit：`17667cdec3e1c5d1feabcf37a83f3f0844f9eb5c`

## 2. 测试环境

- 工作目录：`E:\Software Development\KIROGOVCOMPARE`
- 后端 API：`http://127.0.0.1:8787`，`/api/health` 返回 `status=ok`、`database=connected`
- 前端：`http://127.0.0.1:3001`
- 数据库：使用当前本地 PostgreSQL 连接；未改 schema
- 账号与权限：
  - 管理员：通过本地认证模块生成临时 token，仅用于本轮 API/页面验证，未写入报告或文件
  - 权限边界账号：`huaian`，验证淮安市范围可访问、宿豫区范围不可访问
  - 未登录访问：验证受保护报告接口返回 401

## 3. 样本清单

| 样本 | 类型 | 关键对象 |
|---|---|---|
| 淮安市发展和改革委员会 2024 | 普通年度报告、上传/解析复用样本 | report `4691`，version `4314`，parse job `16916` |
| 清江浦区工业和信息化局 2024-2025 | 长表格比对与 PDF 样本 | comparison `1143`，PDF job `18393` |
| 生态文旅区 2025 | 表三复杂样本、gpt-5.5 样本 | report `4837`，version `4457` |
| 洋河新区 2025 | 缺表/异常与复核阻断样本 | report `4839`，version `4405` |
| 淮安市 2024-2025 | 比对中心、PDF 导出、失败任务对照 | comparison `4670`，P4 PDF job `18473` |
| 淮安市 GovInsight 2025 | GovInsight 城市报告与 PDF | `city_721` / `721`，year `2025` |
| PDF 失败/过期任务 | 异常提示样本 | failed job `18396`，expired job `18278` |
| 权限边界 | 权限样本 | admin、huaian、未登录 |

## 4. 自动验证结果

| 命令 | 结果 | 备注 |
|---|---|---|
| `npm.cmd run build` | 通过 | 后端 TypeScript 构建与 public 复制完成 |
| `npm.cmd test` | 通过 | 19/19 suites，144/144 tests |
| `cd frontend && npm.cmd test -- --runInBand` | 通过 | 18/18 suites，87/87 tests |
| `cd frontend && npm.cmd run build` | 通过 | 存在既有 bundle size warning，无失败 |
| `npm.cmd run smoke:pdf` | 通过 | total 4，passed 4，failed 0，skipped 0 |
| `npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001` | 通过 | strict-live 可用，total 4，passed 4，failed 0，skipped 0 |

strict-live 说明：API `8787` 和前端 `3001` 均可用；comparison PDF、长表格 PDF、GovInsight PDF、pdf-job API 均通过。当前环境缺少 `pdfinfo`、`pdftoppm`、ImageMagick、Ghostscript，PDF smoke 已降级使用 pdfjs 文本/页数/空白页检查。

## 5. 样本链路结果

### 5.1 上传/解析

- 使用 report `4691` 当前真实 PDF 作为准真实上传样本重新上传。
- 上传接口返回 201：`report_id=4691`、`version_id=4314`、`job_id=16916`、`reused_version=true`、`reused_job=true`。
- 解析任务 `16916`：`status=succeeded`、`progress=100`、`step_code=DONE`。
- 该样本未制造新版本，符合 P4-1 优先验证、减少样本污染的要求。

### 5.2 复核/发布

- report `4691`：published active，检查 43 项，FAIL 0，UNCERTAIN 0，open issue 0，可进入比对链路。
- report `4837`：published active，检查 45 项，FAIL 0，UNCERTAIN 0，open issue 0，表三 39 项通过。
- report `4839`：pending_review，检查 44 项，FAIL 2，open issue 2。
- 对 report `4839` 执行发布门禁验证，接口返回 409 `open_review_issues`，未发布，阻断符合预期。
- report `3670` 和 `4304` 保持 published 样本状态，分别存在 5 项和 3 项 open issue，用于复核问题展示与异常样本对照。

### 5.3 比对结果

- comparison `4670`：接口 200，region `淮安市`，similarity `51`，check_status `异常(规范性文件|结转)`，存在 comparison result。
- comparison `1143`：接口 200，region `清江浦区工业和信息化局`，check_status `正常`，存在 comparison result。
- 本轮未重复触发比对创建，避免制造重复 compare job；使用已有真实比对结果验证详情、PDF 与下载链路。

### 5.4 PDF 导出

- 创建 P4-1 PDF 导出任务：comparison `4670` -> job `18473`。
- job `18473`：约 14.3 秒完成，`status=done`、`progress=100`、`file_exists=true`。
- 下载 job `18473`：HTTP 200，`application/pdf`，大小 3,490,359 bytes，文件签名 `%PDF-1.4`。
- 同步兼容接口 `/api/comparisons/4670/pdf`：HTTP 200，`application/pdf`，大小 3,107,263 bytes。
- legacy EJS 兼容接口 `POST /api/comparisons/4670/export/pdf`：HTTP 200，`application/pdf`，包含 `Deprecation: true`、`X-Kiro-Replacement-Route: /api/pdf-jobs`、`X-Kiro-Legacy-Export-Path: comparison-ejs`。

### 5.5 TaskDrawer 观察

- 上传链路：`UploadReport` 仍通过 `TaskDrawerProvider` 跟踪解析任务；接口侧确认 parse job `16916` 成功。
- 比对/PDF 链路：`ComparisonDetailView` 和 `ComparisonHistory` 仍通过 `TaskDrawerProvider` 跟踪 PDF 导出任务；接口侧确认 job `18473` 出现在 `/api/pdf-jobs`。
- `/jobs?tab=download` 接口返回 total `24`，最新 job `18473` 可下载。
- 浏览器层受当前工具登录态写入限制，未完成认证后 TaskDrawer 可视化点击确认；打印路由浏览器隔离验证已完成。

### 5.6 /jobs 与 /jobs?tab=download

- `/api/jobs?page=1&limit=5`：HTTP 200，total `2593`，可见成功与失败解析任务。
- 失败解析任务样本包含 `ANNUAL_REPORT_SEGMENT_VALIDATION_FAILED`，例如缺少 `otherMatters` 或 `table_4`，错误信息可读。
- `/api/pdf-jobs?page=1&limit=10`：HTTP 200，total `24`，最新 P4 job `18473` 为 done。
- failed PDF job `18396` 下载返回 400 `PDF not ready`。
- expired PDF job `18278` 下载返回 410 `File expired`。
- 批量下载 job `[18473, 18393]`：HTTP 200，`application/zip`，大小 3,377,421 bytes，文件签名 `PK`。

### 5.7 GovInsight

- `/api/gov-insight/annual-data?org_id=city_721&year=2025`：HTTP 200。
- `/api/gov-insight/ai-report?org_id=city_721&year=2025`：HTTP 200，`payloadVersion=report_payload_v1`，`payloadSource=stored`，`materializeStatus=preview`。
- `/api/gov-insight/ai-report/payload?org_id=city_721&year=2025`：HTTP 200，后端 payload 可构建。
- `/api/gov-insight/report-pdf?org_id=city_721&year=2025`：HTTP 200，`application/pdf`，998,861 bytes。
- `/api/gov-insight/report-pdf?org_id=721&year=2025`：HTTP 200，`application/pdf`，998,861 bytes。
- 发现：最新 GovInsight job `17` 为 failed，错误为 `overrides?.overallJudgments?.filter is not a function`；但历史成功 job `16` 存在，当前存储报告与 PDF 导出可用。

### 5.8 legacy EJS 与 print route

- legacy EJS 未删除，兼容路径可用，并返回弃用/替代路径响应头。
- 浏览器验证 `/print/comparison/1143`：ready 标记为 true，无 AppShell，无 TaskDrawer，无错误。
- 浏览器验证 `/print/govinsight-report/city_721/2025`：ready 标记为 true，无 AppShell，无 TaskDrawer，无错误。
- 浏览器验证 `/print/govinsight-report/721/2025`：ready 标记为 true，无 AppShell，无 TaskDrawer，无错误。

## 6. 发现问题摘要

| 严重程度 | 数量 |
|---|---:|
| blocker | 0 |
| high | 0 |
| medium | 1 |
| low | 2 |

问题摘要：

1. GovInsight `city_721/2025` 最新生成 job 失败，但存储报告和 PDF 可用。
2. 当前 PDF smoke 缺少原生视觉栈，只能使用 pdfjs 降级检查。
3. 当前工具限制导致认证后 TaskDrawer 可视化点击未完成，已用接口、代码和测试证据补齐。

## 7. 不改动清单

- 未改数据库 schema。
- 未改 PDF 后端主链路。
- 未改 legacy EJS。
- 未改 `/api/pdf-jobs`、`/api/comparisons/:id/pdf`、`/api/gov-insight/report-pdf`。
- 未改 `/print/comparison/:id`、`/print/govinsight-report/:orgId/:year`。
- 未改 `scripts/pdf-smoke-baseline.js`。
- 未提交 PDF、ZIP、截图、HTML dump、日志、dist/build/coverage/node_modules。
- 未提交、未 push、未 merge。

## 8. 是否建议进入 P4-2

建议进入 P4-2，但建议把以下事项作为 P4-2 前置确认或 P4-2 首批问题：

- 先人工登录前端，补一次 TaskDrawer 可视化确认。
- GovInsight 最新失败 job 需要进入问题清单，优先判断是 payload override 数据形态问题还是生成协议兼容问题。
- P4-3 前建议补齐 PDF 原生视觉检查工具链，提升 PDF smoke 的像素级可复核性。

当前未发现 blocker。
