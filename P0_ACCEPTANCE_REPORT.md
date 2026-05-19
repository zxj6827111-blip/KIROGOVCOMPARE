# P0 验收报告：frontend / UX / print fixes

验收日期：2026-05-19  
验收分支：`codex/p0-frontend-ux-print-fixes`  
验收范围：仅做人工 smoke test、静态扫描、PDF 生成与记录；未新增功能，未重构代码。

## 验收环境

- 后端：`http://127.0.0.1:8787/api/health` 返回 `{"status":"ok","database":"connected"}`。
- 前端：`http://127.0.0.1:3001/catalog` 可访问，页面渲染正常。
- 浏览器：Playwright 人工 smoke test。
- 登录态：使用本地 `admin` 测试会话，仅用于页面验收和 PDF 任务创建。
- 样本：
  - 普通比对：`comparison_id=4670`，淮安市，2024 vs 2025。
  - 长表格比对：`comparison_id=1143`，清江浦区工业和信息化局，2024 vs 2025。
  - 不可用样本复核：`comparison_id=3129`，接口返回 `COMPARISON_CONTENT_NOT_READY`，不作为长表格验收通过样本。
  - GovInsight：`org_id=city_721`，淮安市，2025。

## 验收页面

| 页面 | 结果 | 记录 |
| --- | --- | --- |
| `/catalog` | 通过 | 数据概览、导航、区域卡片正常，无登录页回退，无 502/React error。 |
| `/upload` | 通过 | 单个上传/批量上传区域正常；无文件时“上传并启动解析”按钮禁用，未触发无效提交。 |
| `/jobs` | 通过 | 上传任务列表正常加载，筛选区和任务表格未见明显样式错乱。 |
| `/jobs?tab=download` | 通过 | 下载 tab 摘要、列表、过期说明和操作按钮正常。 |
| `/history` | 通过 | 比对历史聚合列表正常加载，导航和表格未见明显错乱。 |
| `/comparison/4670` | 通过 | 比对详情、问题摘要、下载 PDF、网页打印入口正常显示。 |
| `/govinsight` | 通过 | GovInsight dashboard 正常加载，`.gov-dashboard-root` 生效；有 Recharts 容器宽高 warning，页面可用。 |
| `/print/comparison/4670` | 通过 | `#comparison-content[data-print-ready="true"]` 到位；无 GovInsight root 污染。 |
| `/print/comparison/1143` | 通过 | 长表格打印页 `data-print-ready="true"` 到位；首个表格可见，横向打印页未受 GovInsight reset 污染。 |
| `/print/govinsight-report/city_721/2025` | 通过 | `#govinsight-report-print` 存在，`data-govinsight-pdf-ready="true"` 到位。 |
| `/print/govinsight-report/721/2025` | 未通过 | 页面显示“未找到可导出的年度数据”。实际前端数据 orgId 为 `city_721`，纯数字参数当前不兼容。 |

## 验收结果

### CSS token alias

- 静态扫描范围：`frontend/src/**/*.css`。
- CSS 文件数：30。
- `var(--*)` 使用项：90。
- 未定义 CSS 变量：0。
- 结论：P0 token alias 补齐有效，未发现新的缺失变量。运行时变量 `--pdf-total-pages` 未作为问题计入。

### GovInsight print reset 作用域

- `frontend/src/govinsight/tailwind.css` 中 print reset 已限定到 `.gov-dashboard-root`。
- 静态检查未发现 `@media print` 下的全局 `html/body/main/nav/header/footer/table` 规则。
- `/print/comparison/4670` 与 `/print/comparison/1143` 均无 `.gov-dashboard-root`，且 comparison ready 标记正常。
- 结论：未发现 GovInsight 打印 reset 污染比对打印页。

### Toast / Confirm

- PDF 创建成功 Toast：通过。页面提示“PDF 导出任务已创建 ... 查看任务”。
- PDF 下载失败 Toast：通过。通过浏览器临时拦截下载接口返回 500，页面显示“下载失败 Request failed with status code 500”。
- 文件过期提示：通过。点击过期文件“重新生成”弹出 Confirm：“文件已过期 ... 暂不处理 / 重新生成”，取消后未继续执行。
- 表单校验：上传页无文件时提交按钮禁用，属于页面内防护；未触发 Toast。

### 任务中心下载 tab

验收前摘要：可下载 1、生成中 0、失败 0、已过期 5。  
验收后摘要：可下载 3、生成中 0、失败 1、已过期 5。

后端当前 PDF 任务前 20 条统计与页面一致：

- 可下载：3。
- 生成中：0。
- 失败：1。
- 已过期：5。

过期任务行显示“文件已过期，请重新生成”，并提供“重新生成”入口。批量下载说明显示“只会打包已完成且文件未过期的任务”。

### 旧 EJS PDF 链路

- 前端扫描 `frontend/src` 未发现主动调用 `export/pdf`、`comparison_report`、`PdfExportService`、`/pdf-export` 的入口。
- 当前前端比对 PDF 创建入口指向 `/api/pdf-jobs`。
- 后端 legacy 注释和日志已存在于 `PdfExportService`、`comparison_report.ejs`、`comparison-history.ts`、`pdf-export.ts`、`pdf-jobs.ts` 等路径。
- 结论：旧 EJS PDF 链路未发现前端主动入口。

### PDF 导出

普通比对 PDF：

- 任务：`job_id=18384`，`comparison_id=4670`。
- 结果：`done`。
- 文件：`data/exports/pdf/淮安市_2024-2025年报比对.pdf`。
- 大小：3,469,383 bytes。
- PDF.js 抽取：13 页，横向页面，空白页 0，替换字符 `�` 数量 0。

长表格比对 PDF：

- 任务：`job_id=18386`，`comparison_id=1143`。
- 结果：`done`。
- 文件：`data/exports/pdf/清江浦区工业和信息化局_2024-2025年报比对.pdf`。
- 大小：3,007,989 bytes。
- PDF.js 抽取：13 页，横向页面，空白页 0，替换字符 `�` 数量 0。

GovInsight 报告打印页：

- `/print/govinsight-report/city_721/2025` 可打开。
- 页面标题：`淮安市_2025_政务公开智能辅策报告`。
- ready 标记：`data-govinsight-pdf-ready="true"`。
- 页面文本、目录/章节结构可见，未见大面积空白或页眉页脚重叠。

## 发现的问题

1. GovInsight 打印页纯数字 orgId 不兼容：`/print/govinsight-report/721/2025` 显示“未找到可导出的年度数据”，而实际可用路径是 `/print/govinsight-report/city_721/2025`。
2. GovInsight 页面有 Recharts warning：`The width(-1) and height(-1) of chart should be greater than 0`。页面可用，但说明部分图表容器在初始布局时存在测量抖动。
3. 通过脚本直接创建 PDF 任务时，传入的中文 `title` 在任务中心显示为 `P0?? ????? 1143`。UI 自身创建的标题正常，倾向于验收脚本/终端编码问题；若后续支持外部 API 客户端，需要单独确认请求编码。
4. 不可用样本 `comparison_id=3129` 创建 PDF 任务后失败，错误为 `Print page error: Failed to fetch comparison data from backend`。接口真实返回 `COMPARISON_CONTENT_NOT_READY`，不是本次 PDF 样式改动导致，但任务中心会留下失败记录。
5. 控制台中 `ComparisonPrintView` 的调试日志存在源码编码显示异常，不影响页面正文和 PDF 文本，但会影响排障可读性。
6. 当前工作区存在非 P0 范围文件改动，例如 `src/services/SegmentedAnnualReportParse.ts`、`src/__tests__/segmentedAnnualReportParse.test.ts`；本验收未覆盖这些改动。

## 是否建议合并

建议：有条件合并。

P0 目标项中，CSS token alias、GovInsight print reset 作用域、比对 PDF 字体等待后的导出结果、PDF 主入口 `/api/pdf-jobs`、Toast/Confirm 基础能力、任务中心下载 tab 增强均通过验收。

合并前需要确认 GovInsight 报告打印入口的调用方是否只传 `city_721` 这类真实 `org_id`。如果任一入口可能传纯数字 `721`，应先补兼容或改调用方，否则 `/print/govinsight-report/:orgId/:year` 会存在入口级失败。

## 合并前必须修复项

- 必须确认或修复 GovInsight 打印页 `orgId` 参数兼容：`city_721` 可用，`721` 不可用。若产品/后端导出接口可能生成纯数字路径，则这是合并前阻断项；若所有调用方均传真实 `org_id`，可作为 P1 兼容项。

## 可放入 P1/P2 的遗留项

- P1：统一 GovInsight 打印页 orgId 解析规则，前端 `fetchAnnualData` 支持 `city_721` 和 `721` 两种输入，或明确 URL 只能使用真实 `org_id`。
- P1：GovInsight 图表容器补稳定尺寸，消除 Recharts 初始宽高 warning。
- P1：任务中心失败任务可读性增强，将 `COMPARISON_CONTENT_NOT_READY` 一类失败原因显示为“比对内容未就绪”，而不是笼统 “Failed to fetch comparison data”。
- P1：PDF 创建 API 标题输入编码和日志可读性验证，避免外部脚本/客户端传中文标题时出现问号。
- P2：清理打印页调试日志和源码编码显示问题，提升线上排障质量。
- P2：为 PDF 长报告增加自动化视觉回归，包括第一页、中间表格页、末页、页眉页脚、横纵向检查。

