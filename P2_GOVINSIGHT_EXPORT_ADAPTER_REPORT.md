# P2 GovInsight Export Adapter Report

## 1. 修改文件清单

- `src/routes/gov-insight-pdf.ts`
  - 移除 GovInsight 路由内自带的 Puppeteer launch、前端 URL 探测、token 注入、ready selector 等待、字体等待和基础诊断逻辑。
  - 改为通过 `BrowserRenderer.renderPrintPage` 打开 print 页面，再在同一页面上执行 GovInsight 专属的图表稳定、目录二次页码生成和最终 PDF 输出。
- `src/services/report-export/BrowserRenderer.ts`
  - 为 `PrintPageAdapter` 增加可选 `readyPredicate` 执行点。
  - 保持 comparison 既有 selector ready 行为不变；仅在 adapter 声明 predicate 时追加等待。
  - 审核修复：恢复 `fallbackSelector` 成功后的容错路径，fallback 成功时不再抛出原始 `readySelector` timeout，同时仍会继续执行可选 `readyPredicate`。
- `src/services/report-export/PrintPageAdapter.ts`
  - 增加 `PageReadyPredicate`。
  - 补齐 GovInsight A4 print CSS / PDF options。
  - 将 `createGovInsightPrintPageAdapter` 提升为真正可复用的 GovInsight print adapter。
- `P2_GOVINSIGHT_EXPORT_ADAPTER_REPORT.md`
  - 本报告文件。

生成的本地验证证据：

- `output/pdf/govinsight_city_721_2025_after_adapter.pdf`
- `output/pdf/comparison_4670_p2_2_sync.pdf`
- `output/pdf/comparison_1143_p2_2_sync.pdf`
- `output/pdf/comparison_4670_p2_2_async_job_18394.pdf`

## 2. GovInsight PDF 改造前后链路对比

改造前：

1. `/api/gov-insight/report-pdf` 在 `src/routes/gov-insight-pdf.ts` 内自行发现前端地址。
2. 路由内直接启动 Puppeteer。
3. 路由内注入 `admin_token`、打开 `/print/govinsight-report/:orgId/:year`。
4. 路由内等待 `#govinsight-report-print`、`data-govinsight-pdf-ready=true`、`document.fonts.ready`。
5. 路由内执行 GovInsight 图表稳定、DOM TOC 计算、PDF 草稿、PDF 文本抽取、目录页码回写、最终 PDF。

改造后：

1. `/api/gov-insight/report-pdf` 仍保持不变。
2. GovInsight 路由用 `BrowserRenderer.findFrontendUrl` 发现前端地址。
3. GovInsight 路由创建 `createGovInsightPrintPageAdapter({ orgId, year })`。
4. `BrowserRenderer.renderPrintPage` 统一负责浏览器启动、token 注入、导航、ready selector、`data-govinsight-pdf-ready=true` predicate、字体等待、错误诊断和浏览器关闭。
5. GovInsight 路由继续在 render 后的 `page` 上执行专属 PDF 逻辑：图表稳定、目录二次页码生成、header/footer、最终 PDF 响应。

## 3. GovInsightPrintAdapter 职责说明

`createGovInsightPrintPageAdapter` 当前负责定义 GovInsight print 页面的渲染契约：

- print path：`/print/govinsight-report/${orgId}/${year}`。
- token 注入：沿用 `localStorage.admin_token`。
- ready selector：`#govinsight-report-print`。
- ready predicate：等待 `document.documentElement.dataset` 对应的 `data-govinsight-pdf-ready=true`。
- viewport：`1440 x 2200`，`deviceScaleFactor=2`。
- navigation：`networkidle0`，`60000ms`。
- media：`print`。
- page CSS：GovInsight A4 page margin。
- PDF defaults：GovInsight A4 portrait、header/footer enabled、原 margin。
- debug probe：保留 print root 文本诊断入口。

## 4. 复用 BrowserRenderer 的能力

本阶段 GovInsight 已复用：

- 前端 URL 发现，包括候选 host/port、`FRONTEND_URL` placeholder 过滤、React root 检查。
- Puppeteer launch 参数与浏览器可执行文件解析。
- service token / bearer token 注入。
- `waitForPath` 路由确认。
- `readySelector` 等待。
- `fallbackSelector` 容错：`readySelector` 超时后仍会先检查错误态和加载态；fallback 命中时允许继续生成 PDF。
- 新增的 adapter `readyPredicate` 等待。
- hydration wait。
- `document.fonts.ready` 等待。
- `emulateMediaType('print')`。
- adapter style tag 注入。
- 页面错误、控制台、HTML dump、截图等诊断能力。
- 统一 `rendered.close()` 关闭浏览器。

## 5. 保留的 GovInsight 特殊逻辑

以下逻辑未迁入 comparison 链路，也未删除：

- `/api/gov-insight/report-pdf` URL 保持不变。
- `/print/govinsight-report/city_721/2025` 保持可访问。
- `/print/govinsight-report/721/2025` 保持兼容。
- `orgId` / `city_721` / `721` 的 region id 解析保持。
- `gov_open_annual_stats` 数据存在性检查保持。
- GovInsight DOM TOC 计算 `__govinsightComputePdfToc()` 保持。
- PDF 草稿生成、`pdfjs-dist` 文本抽取、目录页码二次回写、最终 PDF 二次生成保持。
- Recharts / ResponsiveContainer 稳定等待逻辑保持。
- GovInsight A4 portrait、页眉、页脚、页码模板保持。
- legacy EJS 未删除。

## 6. 与改造前 baseline 对比

baseline 文件：`P2_GOVINSIGHT_PDF_BASELINE_BEFORE_ADAPTER.md`

测试对象固定为 `city_721 / 2025`。

| 项目 | 改造前 baseline | 改造后 adapter | 结论 |
| --- | ---: | ---: | --- |
| main commit | `14b7ceb7b54a6dbbb89edee01236e9bd92406bbe` | `14b7ceb7b54a6dbbb89edee01236e9bd92406bbe` 起分支 | 同一 main 基线 |
| PDF 文件 | `output/pdf/govinsight_city_721_2025_baseline_before_adapter.pdf` | `output/pdf/govinsight_city_721_2025_after_adapter.pdf` | 已生成 |
| 文件大小 | `649,395 bytes` | `1,042,797 bytes` | 文件体积变大，但结构检查通过 |
| PDF 页数 | `19` | `19` | 无页数退化 |
| 空白页 | `0` | `0` | 无空白页 |
| 目录页码 | 11 个目录项均命中对应页标题 | 11 个目录项均命中对应页标题 | 可信 |
| 页眉页脚 | 未发现重叠 | 未发现重叠 | 正常 |
| Recharts warning | 未发现 | 未发现 | 正常 |
| 现有 PDF smoke | `ok=true` | `ok=true` | 通过 |

改造后目录页码命中情况：

- 一 总体判断：4
- 二 重点风险事项：5
- 三 确认事实：7
- 四 审慎分析：8
- 五 三级监测重点摘要：9
- 六 待补充问题：11
- 七 整改任务清单：12
- 八 结语：16
- 附件一 指标审计与勾稽校验：17
- 附件二 使用边界与口径说明：18
- 附件三 建议补充数据：19

说明：文件大小变化不作为单独阻塞项；本轮用页数、空白页、目录命中、页眉页脚坐标、Recharts warning 和 API 状态判断，没有发现明显输出退化。

## 7. build / test / smoke 结果

- `npm.cmd run build`：通过。
- `npm.cmd test`：通过，18 个 test suites、137 个 tests 全部通过。测试过程中仍有既有 auth 相关 console warning，但不影响结果。
- `npm.cmd run smoke:pdf`：通过。
  - comparison `4670`：13 页，0 空白页，`ok=true`。
  - comparison `1143`：13 页，0 空白页，`ok=true`。
- 现有脚本补充检测：
  - GovInsight after adapter：`node scripts/pdf-smoke-baseline.js --comparison-ids=721 --file=721=output/pdf/govinsight_city_721_2025_after_adapter.pdf`，`ok=true`，19 页，0 空白页。
  - GovInsight before baseline：同脚本复测，`ok=true`，19 页，0 空白页。

审核阻断修复后复测：

- 修复点：`BrowserRenderer.waitForAdapterReady()` 使用 `readyOrFallbackAvailable` 局部状态，区分 ready selector 成功、fallback selector 成功和两者均失败三种情况。
- `npm.cmd run build`：通过。
- `npm.cmd test`：通过，18 个 test suites、137 个 tests 全部通过。测试过程中仍有既有 auth 相关 console warning，但不影响结果。
- `npm.cmd run smoke:pdf`：首次运行发现 comparison `4670` 的最新导出记录指向的本地 PDF 文件不存在；重新通过现有 `/api/pdf-jobs` 生成 smoke fixture 后复跑通过。
  - comparison `4670`：13 页，0 空白页，`ok=true`。
  - comparison `1143`：13 页，0 空白页，`ok=true`。

## 8. 人工验证结果

- `/api/gov-insight/report-pdf?org_id=city_721&year=2025`
  - HTTP `200`
  - Content-Type `application/pdf`
  - Content-Length `1042797`
  - 输出文件 `output/pdf/govinsight_city_721_2025_after_adapter.pdf`
- `/print/govinsight-report/city_721/2025`
  - `#govinsight-report-print` 存在。
  - `data-govinsight-pdf-ready=true`。
  - 章节节点 `11`。
  - 目录页码节点 `11`。
  - 未发现 Recharts width/height warning。
- `/print/govinsight-report/721/2025`
  - `#govinsight-report-print` 存在。
  - `data-govinsight-pdf-ready=true`。
  - 章节节点 `11`。
  - 目录页码节点 `11`。
  - 未发现 Recharts width/height warning。
- GovInsight PDF 目录结构：正常，11 个目录项均能命中对应 PDF 页标题。
- 大面积空白页：未发现，空白页为 `0`。
- 页眉页脚：未发现重叠；页眉约在 `y=819.4`，页脚约在 `y=16.9`，长内容页正文与固定页脚分离。
- 图表：当前 print 页面未检测到 Recharts 节点，且无 Recharts width/height warning。

## 9. comparison PDF 是否受影响

同步接口 `/api/comparisons/:id/pdf`：

- `4670`
  - HTTP `200`
  - Content-Type `application/pdf`
  - Content-Length `3084371`
  - 输出文件 `output/pdf/comparison_4670_p2_2_sync.pdf`
  - smoke：14 页，0 空白页，`ok=true`
- `1143`
  - HTTP `200`
  - Content-Type `application/pdf`
  - Content-Length `2677489`
  - 输出文件 `output/pdf/comparison_1143_p2_2_sync.pdf`
  - smoke：13 页，0 空白页，`ok=true`

异步接口 `/api/pdf-jobs`：

- 创建 comparison `4670` 的 PDF job：成功。
- job id：`18394`。
- 最终状态：`done`，progress `100`。
- 下载接口：`/api/pdf-jobs/18394/download` 返回 PDF。
- 下载文件：`output/pdf/comparison_4670_p2_2_async_job_18394.pdf`。
- 下载文件大小：`3468545 bytes`。
- smoke：13 页，0 空白页，`ok=true`。
- 验证完成后已删除本轮创建的 job 记录；列表中不再存在 `18394`。
- 审核修复后，为恢复现有 `smoke:pdf` 对 comparison `4670` 的本地文件依赖，重新创建过一次 `/api/pdf-jobs` 导出，job id 为 `18395`，状态 `done`，文件名 `淮安市_2024-2025年报比对.pdf`，file size `3468514 bytes`。该文件属于本地验证 fixture，不应提交。

结论：comparison 同步导出和异步导出均未发现回归。

## 10. 风险、遗留问题、是否建议合并

风险：

- GovInsight after adapter PDF 文件体积从 `649,395 bytes` 增至 `1,042,797 bytes`。本轮未发现页数、目录、空白页、页眉页脚或 Recharts 层面的退化，但合并前如需要像素级严查，应补充 PDF 渲染截图比对工具。
- 当前本机没有 `pdftoppm` / `pdfinfo` / ImageMagick / Ghostscript，因此本轮没有做像素级渲染 diff；检查依据为浏览器状态、PDF 文本抽取、文本坐标和现有 smoke 脚本。
- `BrowserRenderer` 新增的 `readyPredicate` 是通用扩展点，默认不启用；comparison adapter 未声明 predicate，因此风险面较小。
- 审核发现的 fallback 阻断问题已修复：fallback selector 成功时不会再抛出原始 ready timeout；如果 adapter 同时声明 `readyPredicate`，仍会在 fallback 命中后继续等待 predicate。

遗留问题：

- 没有新增大型依赖。
- 没有修改数据库 schema。
- 没有改 AppShell、Router、TaskDrawer、CSS 架构等 P3 内容。
- 没有删除 legacy EJS。
- 没有修改 comparison PDF 的 adapter 参数和 worker 主链路。

建议：

- 建议合并 P2-2。当前验证覆盖 GovInsight API、两个 print URL、GovInsight PDF 结构、comparison 同步导出、comparison 异步导出，以及必需的 build/test/smoke。
