# P2-1 报告导出服务统一基础阶段报告

## 1. 本阶段修改文件

- `src/services/report-export/BrowserRenderer.ts`
  - 新增统一浏览器渲染能力：前端 URL 发现、Puppeteer 启动、页面打开、service token / localStorage token 注入、ready selector 等待、字体等待、调试截图和 HTML dump、PDF buffer 输出。
- `src/services/report-export/PrintPageAdapter.ts`
  - 新增打印页 adapter 协议和比对报告 adapter。
  - 预留 GovInsight adapter 描述能力，但本阶段没有把 GovInsight PDF 路由切入新渲染器。
- `src/routes/pdf-export.ts`
  - `/api/comparisons/:id/pdf` 同步导出改为使用 `BrowserRenderer + createComparisonPrintPageAdapter`。
  - 保持原 URL、鉴权、权限校验、响应头、下载行为不变。
- `src/services/PdfExportWorker.ts`
  - `/api/pdf-jobs` 背后的异步 worker 改为使用同一套 `BrowserRenderer + createComparisonPrintPageAdapter`。
  - 保持原 job 查询、状态流转、文件目录、文件名、下载链路不变。
- `src/services/PdfExportService.ts`
  - 仅补充 legacy EJS 状态注释，未删除、未迁移该兼容路径。
- `P2_REPORT_EXPORT_SERVICE_PHASE1_REPORT.md`
  - 本报告。

## 2. PDF 导出链路改造前后对比

改造前：

- 同步 PDF：`src/routes/pdf-export.ts` 内直接维护 Puppeteer launch、前端 URL 探测、页面访问、ready selector 等待、字体等待和 PDF 参数。
- 异步 PDF：`src/services/PdfExportWorker.ts` 内重复维护另一套 Puppeteer launch、前端 URL 探测、ready 等待、打印 CSS 注入和 PDF 参数。
- legacy EJS：`src/services/PdfExportService.ts` 仍通过 EJS 渲染 HTML，再用 Puppeteer 生成 PDF，属于兼容接口。
- GovInsight PDF：`src/routes/gov-insight-pdf.ts` 仍是独立 Puppeteer 路由，包含 GovInsight 专属 TOC、图表稳定和页眉页脚逻辑。

改造后：

- 比对报告同步 PDF 和异步 PDF 共用 `BrowserRenderer` 的浏览器基础能力。
- 比对打印页差异点集中在 `PrintPageAdapter`：URL、ready selector、viewport、PDF 参数、打印 CSS、诊断名称。
- legacy EJS 继续保留，仅明确标记为兼容路径。
- GovInsight PDF 未切入新服务，保持原链路不变；仅在 adapter 层做未来设计预留。

## 3. BrowserRenderer / PrintPageAdapter 职责

`BrowserRenderer` 负责和“怎么渲染一个打印页”有关的通用能力：

- 查找可用前端地址，并忽略 `.env` 中的占位 `FRONTEND_URL=https://your-domain.com`。
- 统一启动 Puppeteer，设置基础参数。
- 统一打开打印页，并隐藏日志中的 service token。
- 支持 query token 和 localStorage token 注入。
- 等待 ready selector、fallback selector、字体加载和可配置延迟。
- `PDF_EXPORT_DEBUG=1` 时输出截图与 HTML dump。
- 输出 PDF buffer，或返回 page 供更复杂流程继续操作。

`PrintPageAdapter` 负责描述“要渲染哪类打印页”：

- 打印页 path 和 query。
- ready selector / fallback selector / 错误 selector。
- viewport、media type、额外 CSS、PDF 参数。
- 诊断名称和日志标签。
- 当前实际切入的是 comparison adapter；GovInsight adapter 只做预留。

## 4. 同步 PDF 与异步 PDF 如何共用新能力

- `/api/comparisons/:id/pdf`
  - 保留原有 comparison 权限校验。
  - 生成当前登录用户的短期 service token。
  - 使用 `createComparisonPrintPageAdapter(...)` 构造比对打印页描述。
  - 调用 `renderPdfBuffer(...)` 生成 PDF 并直接返回二进制响应。

- `PdfExportWorker`
  - 保留原有 `jobs` 查询、`queued -> running -> done/failed` 状态流转。
  - 使用 service user 生成短期 service token。
  - 使用同一个 `createComparisonPrintPageAdapter(...)`。
  - 通过 `BrowserRenderer` hooks 保留原进度节点：`Browser started`、`Loading print page`、`Rendering content`、`Generating PDF`。
  - PDF 文件仍写入 `data/exports/pdf`，下载接口不变。

## 5. legacy EJS 当前状态

- `src/services/PdfExportService.ts` 和 `src/views/comparison_report.ejs` 仍保留。
- `POST /api/comparisons/:id/export/pdf` 兼容接口未删除。
- 本阶段没有把 legacy EJS 切到新渲染器，也没有改变其模板或输出路径。

## 6. GovInsight 是否保持不受影响

- `src/routes/gov-insight-pdf.ts` 未修改。
- `frontend/src/components/print/GovInsightReportPrintView.tsx` 未修改。
- `frontend/src/govinsight/**` 未修改。
- 人工验证：
  - `/govinsight#/` 正常显示 GovInsight 首页内容，存在 `.gov-dashboard-root`。
  - `/print/govinsight-report/city_721/2025` 正常显示，`#govinsight-report-print` 存在，`data-govinsight-pdf-ready=true`。

## 7. build / test / smoke 执行结果

- `npm.cmd run build`
  - 通过。
- `npm.cmd test`
  - 通过，18 个 test suites、137 个 tests 全部通过。
  - 测试过程中仍有既有 `JWT_SECRET` 测试日志和 bcrypt 迁移警告，不影响测试结果。
- `npm.cmd run smoke:pdf`
  - 通过。
  - `comparison_id=4670`：`淮安市_2024-2025年报比对.pdf`，13 页，0 空白页，无替换字符，ready marker 检查通过。
  - `comparison_id=1143`：`清江浦区工业和信息化局_2024-2025年报比对.pdf`，13 页，0 空白页，无替换字符，ready marker 检查通过。

## 8. 人工验证结果

- `comparison_id=4670 PDF 正常`
  - 同步 `/api/comparisons/4670/pdf` 返回 `200 application/pdf`，约 3.09 MB。
  - 异步 `/api/pdf-jobs` 任务 `18392` 完成，下载返回 `200 application/pdf`，约 3.47 MB。
- `comparison_id=1143 PDF 正常`
  - 同步 `/api/comparisons/1143/pdf` 返回 `200 application/pdf`，约 2.68 MB。
  - 异步 `/api/pdf-jobs` 任务 `18393` 完成，下载返回 `200 application/pdf`，约 3.01 MB。
- `/comparison/1143 可生成 PDF`
  - 页面正常打开，标题为 `比对报告_清江浦区工业和信息化局_2024-2025`。
  - 页面存在 `生成 PDF`、`打印预览`、`查看导出任务` 等 PDF 相关入口。
- `/jobs?tab=download 可下载 PDF`
  - 下载任务页显示 P2-1 生成的 1143 / 4670 任务为“已完成”。
  - 点击第一条下载按钮成功触发下载，文件名为 `清江浦区工业和信息化局_2024-2025年报比对.pdf`。
- `/print/comparison/1143 ready 正常`
  - `#comparison-content` 存在。
  - `#comparison-content[data-print-ready="true"]` 存在。
  - 文本内容长度约 6494，页面标题为 `比对报告_清江浦区工业和信息化局_2024vs2025`。
- `/govinsight 不受影响`
  - `/govinsight#/` 正常显示 GovInsight dashboard，存在 `.gov-dashboard-root`，页面包含“全景态势 / 当前分析对象 / 数据中心”等内容。
- `/print/govinsight-report/city_721/2025 不受影响`
  - 页面标题为 `淮安市_2025_政务公开智能辅策报告`。
  - `#govinsight-report-print` 存在。
  - `data-govinsight-pdf-ready=true`。

## 9. 风险、遗留问题、下一阶段建议

风险和遗留问题：

- 本阶段只统一 comparison PDF 的 Puppeteer 基础能力，没有切 GovInsight PDF，GovInsight 仍保留独立复杂逻辑。
- `BrowserRenderer.renderPrintPage(...)` 已支持返回 page，供 GovInsight 这类需要二次计算 TOC 的复杂流程使用，但还没有在真实 GovInsight 路由中验证接入。
- 当前同步 PDF 保持兼容接口，但用户主路径仍建议走 `/api/pdf-jobs`。
- 本次真实验收产生了两个新的已完成 PDF job 记录和对应 PDF 文件，属于验收产物，没有清理。

下一阶段建议：

- P2-2 再评估是否将 GovInsight PDF 切到 `BrowserRenderer.renderPrintPage(...)`，同时保留其 TOC、页眉页脚、图表稳定逻辑。
- P2-2 或 P2-3 可补充针对 `BrowserRenderer` 的单元测试，覆盖 URL 发现、占位 URL 忽略、adapter URL 构造和错误诊断。
- 在正式切 GovInsight 前，先冻结 GovInsight 当前 PDF 输出样本，避免改动 TOC 页码和图表稳定行为时缺少对照。
