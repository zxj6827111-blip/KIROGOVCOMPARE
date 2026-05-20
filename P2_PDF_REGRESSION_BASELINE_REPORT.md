# P2-4 PDF 自动化回归和长报告稳定性基线报告

## 1. 修改文件清单

- `scripts/pdf-smoke-baseline.js`
- `src/__tests__/pdfJobsRegression.test.ts`
- `P2_PDF_REGRESSION_BASELINE_REPORT.md`

未修改业务页面结构、URL、数据库 schema、legacy EJS 模板或旧接口。未引入新依赖。

## 2. 改造前 smoke:pdf 能力

改造前 `npm run smoke:pdf` 只执行 `node scripts/pdf-smoke-baseline.js`，能力范围为：

- 从 `jobs` 表读取指定 comparison 的最近 `done` PDF 文件。
- 默认覆盖 `comparison_id=4670` 和 `comparison_id=1143`。
- 检查文件存在、页数大于 0、空白页为 0、无替换字符 `�`、包含基础 print-ready 文本。

主要缺口：

- 不覆盖 GovInsight PDF。
- 不覆盖 `/api/pdf-jobs` 创建、完成、下载。
- 不覆盖 failed job、过期/缺失文件、批量下载。
- 不检查关键标题/章节矩阵。
- 不检查长表格报告尾部是否明显截断。
- 不检查 GovInsight 目录页码可信性、页眉页脚边带或 Recharts warning。
- 不输出工具降级说明。

## 3. P2-4 新增覆盖范围

增强后的 `smoke:pdf` 保持一键运行，并明确分为两层覆盖：

- 默认 `npm run smoke:pdf`：强制覆盖本地已有的 comparison PDF 基线（`4670`、`1143`），GovInsight 优先走 live API，若 API 不可用则使用本地 fixture；`/api/pdf-jobs` live、Recharts 控制台检查在本地服务不可用时会记录为 skipped，不把 skipped 误报成已强制验证。
- `npm run smoke:pdf -- --strict-live`：用于 CI 或人工验收，强制要求 GovInsight live API、`/api/pdf-jobs` live、Recharts 检查全部执行；任何 skipped 或 failed 都会使 smoke 整体失败。

新增检查范围包括：

- comparison 普通报告：`comparison_id=4670`。
- 长表格 comparison 报告：`comparison_id=1143`。
- GovInsight 报告：`city_721 / 2025`（默认 live API 优先、fixture 兜底；`--strict-live` 强制 live API）。
- PDF 基础质量：文件存在、页数、空白页、替换字符、print ready marker。
- 关键标题和章节文本检查。
- 长表格报告尾部检查，避免明显截断。
- GovInsight 目录页码可信性检查：目录页数字必须落在总页数内、递增，并且目标页包含对应章节标题。
- GovInsight 页眉页脚坐标边带检查，避免和正文重叠。
- Recharts width/height warning 检查：本地 frontend 可用时通过浏览器控制台检查，`--strict-live` 下不可跳过。
- `/api/pdf-jobs` live 检查：创建、完成、下载、failed job、缺失文件、batch-download，`--strict-live` 下不可跳过。
- route-level Jest regression：不依赖真实服务，固定 failed/missing/batch 语义。

如果本地没有 `pdfinfo`、`pdftoppm`、ImageMagick、Ghostscript，则自动降级为 `pdfjs-dist` 文本/页数/坐标/ready marker 检查，并在 JSON 输出中写入 `capabilityNotes`。

## 4. 样本矩阵

| 样本 | 类型 | 执行入口 | 关键检查 |
| --- | --- | --- | --- |
| `comparison_id=4670` | 普通 comparison PDF | `smoke:pdf` 默认 | 文件存在、13 页、0 空白页、无 `�`、关键章节、print marker |
| `comparison_id=1143` | 长表格 comparison PDF | `smoke:pdf` 默认 | 文件存在、13 页、0 空白页、无 `�`、关键章节、尾部 `数据勾稽问题清单` |
| `city_721 / 2025` | GovInsight PDF | 默认 live API 优先，否则 fixture；`--strict-live` 强制 live API | 19 页、0 空白页、无 `�`、目录页码、页眉页脚、章节标题 |
| failed job | 负向任务 | 默认由 Jest 固定语义；`--strict-live` 追加 live API | 下载必须返回 `400 PDF not ready`，不能误判通过 |
| missing/expired file | 负向文件 | 默认由 Jest 固定语义；`--strict-live` 追加 live API | 下载必须返回 `410 File expired` 且 `needs_regeneration=true` |
| batch download | 批量下载 | 默认由 Jest 固定语义；`--strict-live` 追加 live API | 返回 `application/zip`，只包含完成且文件存在的 PDF |

## 5. 每个样本检查项

Comparison 样本：

- `file_exists`
- `page_count_positive`
- `minimum_page_count`
- `blank_pages_zero`
- `no_replacement_char`
- `print_ready_marker`
- `required_titles_and_sections`
- `long_table_not_obviously_truncated`，仅 `1143`

GovInsight 样本：

- `page_count_positive`
- `blank_pages_zero`
- `no_replacement_char`
- `print_ready_marker`
- `required_titles_and_sections`
- `toc_page_numbers_trusted`
- `header_footer_not_overlapping`
- `recharts_width_height_warning`

PDF job API 样本：

- `job_create_returns_201`
- `job_reaches_done`
- `job_download_returns_pdf`
- `download_pdf_page_count_positive`
- `download_pdf_blank_pages_zero`
- `download_pdf_no_replacement_char`
- `failed_job_not_downloadable`
- `missing_or_expired_file_returns_410`
- `batch_download_returns_zip`

## 6. 普通 comparison 4670 验证结果

默认 `npm.cmd run smoke:pdf`：

- 文件：`data/exports/pdf/淮安市_2024-2025年报比对.pdf`
- 页数：13
- 空白页：0
- 替换字符：无
- print ready marker：通过
- 关键文本：`淮安市`、`2024`、`2025`、`政府信息公开`、`总体情况`、`主动公开政府信息情况`、`收到和处理政府信息公开申请情况` 均命中

结论：通过。

## 7. 长表格 comparison 1143 验证结果

默认 `npm.cmd run smoke:pdf`：

- 文件：`data/exports/pdf/清江浦区工业和信息化局_2024-2025年报比对.pdf`
- 页数：13
- 空白页：0
- 替换字符：无
- print ready marker：通过
- 关键文本：`清江浦区`、`2024`、`2025`、`政府信息公开`、`收到和处理政府信息公开申请情况`、`数据勾稽问题清单` 均命中
- 长表格尾部检查：`tailHasChecklist=true`，最后一页文本长度大于阈值

结论：通过。

## 8. GovInsight city_721 / 2025 验证结果

默认 `npm.cmd run smoke:pdf` 的 GovInsight 覆盖策略是 live API 优先；本地服务不可用时使用既有 fixture，若两者都不可用则记录 skipped。默认模式的 skipped 表示“未强制验证 live 链路”，不能解读为 live API 已通过。

- 来源：`output/pdf/govinsight_city_721_2025_after_adapter.pdf`
- 页数：19
- 空白页：0
- 替换字符：无
- print ready marker：通过
- 关键章节：目录、总体判断、重点风险事项、确认事实、审慎分析、整改任务清单、指标审计与勾稽校验、建议补充数据均命中
- 目录页码可信：通过，10 个目录项均能定位到对应目标页
- 页眉页脚：19 页均检测到页眉/页脚，正文边带距离通过

`npm.cmd run smoke:pdf -- --strict-live` 会强制 GovInsight 走真实 API；本轮 strict live smoke 通过了真实 API 导出：

- 来源：`http://127.0.0.1:8787/api/gov-insight/report-pdf`
- 页数：19
- Recharts width/height warning：0 条

结论：通过。

## 9. 失败任务样本验证结果

覆盖方式：

- `src/__tests__/pdfJobsRegression.test.ts` 固定 mock failed job。
- `--strict-live` smoke 会在没有合适历史样本时临时插入 failed `pdf_export` job，并在结束时删除该脚本插入的 DB 记录。

验证结果：

- failed job 下载返回 `400`。
- 响应包含 `error: PDF not ready`。
- 不会被误判为 PDF 下载成功。

结论：通过。

## 10. 过期/缺失文件样本验证结果

覆盖方式：

- `src/__tests__/pdfJobsRegression.test.ts` 固定 mock missing file job。
- `--strict-live` smoke 会临时插入 `done` 但 `file_path` 指向不存在文件的 job，并在结束时删除该脚本插入的 DB 记录。

验证结果：

- 缺失文件下载返回 `410`。
- 响应包含 `error: File expired`。
- 响应包含 `needs_regeneration: true`。

结论：通过。

## 11. 批量导出/批量下载验证结果

覆盖方式：

- route-level Jest 覆盖 batch download，只打包完成且文件存在的任务。
- `--strict-live` smoke 调用 `/api/pdf-jobs/batch-download`。

验证结果：

- strict live 返回 `200`。
- `Content-Type` 为 `application/zip`。
- ZIP 字节数大于 100。
- 当前 live 结果示例：`bytes=3369538`。

结论：通过。

## 12. build/test/smoke 结果

合并后 main 基线：

- `npm.cmd run build`：通过。
- `npm.cmd test`：通过，18 suites / 139 tests。
- `npm.cmd run smoke:pdf`：通过，改造前仅覆盖 `4670`、`1143`。

P2-4 修改后：

- `node --check scripts/pdf-smoke-baseline.js`：通过。
- `npm.cmd test -- --runInBand src/__tests__/pdfJobsRegression.test.ts`：通过，5 tests。
- `npm.cmd run build`：通过。
- `npm.cmd test`：通过，19 suites / 144 tests。
- `npm.cmd run smoke:pdf`：通过；默认模式允许 live API / Recharts 项在服务不可用时 skipped，主要作为可重复的本地 comparison PDF 基线。
- `npm.cmd run smoke:pdf -- --strict-live`：通过，`4 passed / 0 failed / 0 skipped`；这是 GovInsight live API、`/api/pdf-jobs` live 和 Recharts warning 的强制验收入口。

测试中的 JWT/legacy EJS warning 为现有测试日志，不影响通过状态。

## 13. 是否引入新依赖

否。

继续复用现有依赖：

- `pdfjs-dist`
- `puppeteer`
- `archiver`
- `supertest`

## 14. 是否依赖本地绝对路径

脚本不依赖硬编码本地绝对路径。

- comparison 默认从数据库最近完成 job 解析 PDF 路径。
- 支持 `--file=<comparison_id>=<pdf_path>` 覆盖。
- GovInsight 支持 live API，也支持 `--govinsight-file=<pdf_path>`。
- 输出展示会尽量转成相对路径。

注意：默认 smoke 需要当前数据库中存在对应 PDF job 记录，或者显式传入文件路径。生成的 PDF、ZIP、`.codex-temp` JSON 都不应提交。

## 15. 遗留问题

- 本机未安装 `pdfinfo`、`pdftoppm`、ImageMagick、Ghostscript，因此本阶段未做像素级 diff；已降级为 `pdfjs-dist` 文本、页数、坐标和 ready marker 检查。
- `smoke:pdf` 默认模式在 API/frontend 未启动时会跳过 live API 与 Recharts 控制台检查；报告中的 skipped 只代表未执行，不代表 live 链路已通过。CI 或人工验收应使用 `--strict-live` 强制要求 live 项全部执行。
- strict live 会创建一个真实 API PDF job 和必要的负向样本 job。脚本只会清理本脚本直接插入的临时负向样本，以及已到终态且 `export_title` 精确匹配本轮 `P2-4 PDF smoke ...` 标题的 API job DB 记录；如果 API job 轮询超时或仍在运行，脚本只记录失败，不删除该 job，避免影响仍在处理的真实任务。清理逻辑不会删除共享 PDF 文件。

## 16. 后续进入 P3 前建议

- 若进入 P3 前要把 PDF 稳定性作为 CI gate，建议在 CI 环境固定启动 backend/frontend，并执行 `npm.cmd run smoke:pdf -- --strict-live`。
- 若需要视觉级回归，再安装并固定 `pdftoppm` / ImageMagick / Ghostscript 工具链，新增像素或截图 diff；不建议在 P2-4 临时引入大型依赖。
- 后续如果要覆盖更多 GovInsight 城市或年度，优先以样本矩阵扩展脚本参数，不改变现有 URL 或页面结构。

## 17. 是否建议合并

建议合并。

理由：

- 修改范围严格限制在 PDF smoke/regression 脚本、PDF job route 测试和本报告。
- 不进入 P3，不修改业务页面结构，不改 URL，不改 schema，不删除 legacy EJS。
- build、全量测试、默认 smoke 和 strict live smoke 均通过。
- 生成物和本地临时文件均未纳入仓库提交范围。
