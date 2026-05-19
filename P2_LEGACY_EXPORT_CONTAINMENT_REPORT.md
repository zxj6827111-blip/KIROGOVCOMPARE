# P2-3 legacy export containment report

## 1. 修改文件清单

- `src/routes/comparison-history.ts`
  - `POST /api/comparisons/:id/export/pdf` legacy EJS 兼容接口增加 deprecated headers。
  - 增加 `X-Kiro-Legacy-Export-Trace`，仅沿用通过规范化校验的 `X-Request-Id` / `X-Correlation-Id`，便于日志追踪。
  - legacy 调用日志统一为 `[DeprecatedLegacyEjsPdfExport]`。
- `src/services/PdfExportService.ts`
  - 将 EJS renderer 明确标记为 deprecated legacy compatibility renderer。
  - 接收并打印 trace id，日志统一为 `[DeprecatedLegacyEjsRenderer]`。
- `src/views/comparison_report.ejs`
  - 在模板顶部增加 `DEPRECATED LEGACY EJS TEMPLATE` 标记。
- `src/views/partials/table_3.ejs`
  - 修复 legacy EJS helper 语法，使旧接口仍可兼容生成 PDF。
- `src/__tests__/legacyCompareTasks.test.ts`
  - 增加 legacy EJS PDF 旧接口兼容测试，覆盖 deprecation headers、合法 trace id 沿用、非法或过长 trace id 回退。
- `P2_LEGACY_EXPORT_CONTAINMENT_REPORT.md`
  - 本报告。

## 2. 当前所有 PDF / 导出接口清单

| 接口 | 方法 | 定位 | 当前实现 |
| --- | --- | --- | --- |
| `/api/pdf-jobs` | `POST` | comparison PDF 主链路 | 创建 `pdf_export` job，由 `PdfExportWorker` + `BrowserRenderer` 渲染 React print page |
| `/api/pdf-jobs` | `GET` | 下载任务列表 | 供 `/jobs?tab=download` 查询 PDF job |
| `/api/pdf-jobs/:id/download` | `GET` | 下载链路 | 下载已完成的 comparison PDF |
| `/api/pdf-jobs/:id/regenerate` | `POST` | 兼容维护链路 | 重新排队过期 PDF job |
| `/api/pdf-jobs/:id` | `DELETE` | 维护链路 | 删除 PDF job 及文件 |
| `/api/pdf-jobs/batch-download` | `POST` | 批量下载链路 | 打包已完成 PDF |
| `/api/comparisons/:id/pdf` | `GET` | comparison 同步兼容链路 | `BrowserRenderer` + React print page 同步返回 PDF |
| `/api/gov-insight/report-pdf` | `GET` | GovInsight 主链路 | `BrowserRenderer` + GovInsight print page 同步返回 PDF |
| `/api/comparisons/:id/export/pdf` | `POST` | legacy EJS 兼容链路 | `PdfExportService` + `comparison_report.ejs`，保留兼容，不作为前端主入口 |
| `/api/comparisons/:id/export` | `GET` | JSON export 数据链路 | 返回 comparison export JSON，不生成 PDF |
| `/api/report-maintenance/export` | `GET` | CSV 维护导出链路 | 非 PDF，不在本阶段修改 |

## 3. 每个接口定位

- 主链路：`POST /api/pdf-jobs`
- comparison 同步兼容链路：`GET /api/comparisons/:id/pdf`
- GovInsight 主链路：`GET /api/gov-insight/report-pdf`
- legacy EJS 兼容链路：`POST /api/comparisons/:id/export/pdf`
- 下载任务管理链路：`GET /api/pdf-jobs`、`GET /api/pdf-jobs/:id/download`、`POST /api/pdf-jobs/:id/regenerate`、`DELETE /api/pdf-jobs/:id`、`POST /api/pdf-jobs/batch-download`

## 4. 前端当前调用来源

- `frontend/src/components/ComparisonHistory.js`
  - 单个导出：`apiClient.post('/pdf-jobs')`
  - 批量导出：逐个 `apiClient.post('/pdf-jobs')`
  - 任务入口：跳转 `/jobs?tab=download`
- `frontend/src/components/ComparisonDetailView.js`
  - 详情页导出：`apiClient.post('/pdf-jobs')`
- `frontend/src/components/JobCenter.js`
  - 列表：`apiClient.get('/pdf-jobs')`
  - 下载：`apiClient.get('/pdf-jobs/:id/download')`
  - 重新生成：`apiClient.post('/pdf-jobs/:id/regenerate')`
  - 删除：`apiClient.delete('/pdf-jobs/:id')`
  - 批量下载：`POST /pdf-jobs/batch-download`
- `frontend/src/components/ReportDetail.js`
  - 查询 PDF job 状态：`apiClient.get('/pdf-jobs')`
- `frontend/src/govinsight/views/ReportGenerator.tsx`
  - GovInsight 导出：`apiClient.get('/gov-insight/report-pdf')`

## 5. legacy EJS 是否仍被前端主动调用

否。只读审计未发现前端调用 `POST /api/comparisons/:id/export/pdf`。

当前前端 comparison PDF 主动入口均走 `/api/pdf-jobs`；GovInsight 走 `/api/gov-insight/report-pdf`。

## 6. legacy EJS deprecated 标记、日志或 header

本阶段新增：

- Response header：
  - `Deprecation: true`
  - `Link: </api/pdf-jobs>; rel="successor-version"`
  - `X-Kiro-Deprecated-Route: POST /api/comparisons/:id/export/pdf`
  - `X-Kiro-Replacement-Route: /api/pdf-jobs`
  - `X-Kiro-Legacy-Export-Path: comparison-ejs`
  - `X-Kiro-Legacy-Export-Trace: <trace-id>`
  - `Access-Control-Expose-Headers` 暴露上述 header
- Route 日志：
  - `[ComparisonHistory][DeprecatedLegacyEjsPdfExport] trace=... route="POST /api/comparisons/:id/export/pdf" replacement="/api/pdf-jobs" comparison=... user=...`
- Renderer 日志：
  - `[PdfExportService][DeprecatedLegacyEjsRenderer] trace=... comparison=... template=comparison_report.ejs replacement=/api/pdf-jobs`
- Template 标记：
  - `comparison_report.ejs` 顶部注明 `DEPRECATED LEGACY EJS TEMPLATE`

### Trace id 规范化策略

- legacy EJS 路由按顺序读取 `X-Request-Id`、`X-Correlation-Id`。
- 客户端 trace id 会先 `trim`，然后必须匹配 `^[A-Za-z0-9._:-]{1,80}$`。
- 空值、非法字符、超过 80 字符的输入不进入响应 header 或日志，统一回退为服务端生成的 `legacy-ejs-<comparisonId>-<timestamp>-<random>`。
- `X-Kiro-Legacy-Export-Trace`、route 日志和 renderer 日志均使用规范化后的 trace id。

## 7. 是否保持旧接口兼容

是。

人工验证中 `POST /api/comparisons/4670/export/pdf` 返回 `200`，`Content-Type: application/pdf`，同时带有 deprecation header 和 trace id。

本阶段没有删除 legacy EJS、没有删除旧接口、没有修改 URL、没有改数据库 schema。

## 8. build/test/smoke 结果

- `npm.cmd test -- --runInBand src/__tests__/legacyCompareTasks.test.ts`：通过，覆盖 legacy EJS trace id 规范化修正
- `npm.cmd run build`：通过
- `npm.cmd test`：通过，18 个 test suites / 139 个 tests 全部通过
- `npm.cmd run smoke:pdf`：通过
  - `comparisonId=4670`：PDF 存在，13 页，空白页 0，print ready marker OK
  - `comparisonId=1143`：PDF 存在，13 页，空白页 0，print ready marker OK

新增测试覆盖点：

- 合法 `X-Request-Id` 会被沿用到 `X-Kiro-Legacy-Export-Trace`。
- 含非法字符或超过 80 字符的 `X-Request-Id` 不会原样进入 `X-Kiro-Legacy-Export-Trace`，会回退为服务端生成的安全 trace id。
- legacy EJS 旧接口仍返回 `Deprecation`、`Link`、`X-Kiro-Deprecated-Route`、`X-Kiro-Replacement-Route` 等 deprecation headers。

## 9. 人工验证结果

验证方式：临时启动当前分支后端 `127.0.0.1:8787` 和当前前端 build `127.0.0.1:3001`，3001 仅代理当前 8787；验证结束后停止临时服务。

| 项 | 结果 |
| --- | --- |
| `/api/pdf-jobs` 仍是 comparison PDF 主链路 | 通过。创建 job `18400`，worker 日志显示 `Using recommended /api/pdf-jobs comparison PDF export pipeline` |
| `/api/pdf-jobs` 创建、完成、下载 | 通过。job `18400` 完成，下载 `application/pdf`，约 3.47 MB，13 页，空白页 0 |
| `/api/comparisons/4670/pdf` | 通过。`200 application/pdf`，约 3.08 MB，14 页，空白页 0 |
| `/api/comparisons/1143/pdf` | 通过。`200 application/pdf`，约 2.68 MB，13 页，空白页 0 |
| `/api/gov-insight/report-pdf?org_id=city_721&year=2025` | 通过。`200 application/pdf`，约 1.04 MB，19 页，空白页 0 |
| `/print/govinsight-report/city_721/2025` | 通过。页面 title 为 `淮安市_2025_政务公开智能辅策报告`，ready marker 存在 |
| `/print/govinsight-report/721/2025` | 通过。页面 title 为 `淮安市_2025_政务公开智能辅策报告`，ready marker 存在 |
| `POST /api/comparisons/4670/export/pdf` legacy EJS | 通过。`200 application/pdf`，约 2.89 MB，8 页，deprecation header 和 trace id 存在 |
| legacy EJS 调用日志/header 可追踪 | 通过。trace=`p2-3-legacy-observation`，route/service 日志均可检索 |
| 前端不主动调用 legacy EJS | 通过。前端调用审计未发现 `/export/pdf` 调用点 |
| `/jobs?tab=download` | 通过。认证态页面显示任务中心和下载摘要，`download-summary-panel` 存在 |
| Recharts width/height warning | 未发现相关 console warning |
| GovInsight PDF 大面积空白页 | 未发现，PDF text 检查空白页 0 |
| GovInsight PDF 页眉页脚重叠 | 未发现自动化文本异常；本阶段未做版式改动 |

补充：人工验证过程中曾发现 legacy EJS `table_3.ejs` helper 语法导致旧接口 500；已按本阶段“保持旧接口兼容”的边界做最小修复，并在最终验证中确认旧接口恢复为 `200 application/pdf`。

## 10. 观察期建议

- 观察期建议：至少 2 个发布周期或 14 天，取较长者。
- 观察对象：
  - 后端日志中 `[DeprecatedLegacyEjsPdfExport]`
  - 后端日志中 `[DeprecatedLegacyEjsRenderer]`
  - 响应 header `X-Kiro-Legacy-Export-Trace`
  - 任意客户端继续调用 `POST /api/comparisons/:id/export/pdf` 的来源
- 建议每周统计一次 legacy 调用次数、调用用户、comparison id、失败率。

## 11. 下线条件

全部满足后再进入后续阶段讨论下线：

- 观察期内无前端主动调用 legacy EJS。
- 生产日志中 legacy EJS 调用量为 0，或调用来源已确认并迁移。
- `/api/pdf-jobs` 主链路稳定覆盖单个、批量、任务中心下载、重新生成。
- `/api/comparisons/:id/pdf` 同步兼容链路稳定。
- GovInsight PDF 不依赖 legacy EJS。
- 已有明确回滚方案和监控口径。

## 12. 回滚方案

- 若 deprecation header 或日志影响旧客户端：
  - 回滚 `src/routes/comparison-history.ts` 中 header/log 相关改动。
- 若 legacy EJS 兼容出现异常：
  - 回滚 `src/services/PdfExportService.ts` 的 trace 参数和日志改动。
  - 回滚 `src/views/comparison_report.ejs` 标记改动。
  - 保留或回滚 `src/views/partials/table_3.ejs` 需按实际异常判断；该修复只恢复 legacy EJS 可编译性。
- 若测试约束不适配：
  - 回滚 `src/__tests__/legacyCompareTasks.test.ts` 新增用例。
- 主链路 `/api/pdf-jobs`、`/api/comparisons/:id/pdf`、`/api/gov-insight/report-pdf` 未被改动；主链路无需回滚。

## 13. 是否建议合并

建议合并。

理由：

- 改动范围仅限 legacy EJS 收口、可观测性和测试。
- 没有删除旧接口，没有修改 URL，没有改 schema。
- 前端主链路仍是 `/api/pdf-jobs`，GovInsight 主链路仍是 `/api/gov-insight/report-pdf`。
- 完整 build/test/smoke 通过。
- 人工验证确认主链路、同步兼容链路、GovInsight PDF 和 legacy EJS 旧接口均可用。
