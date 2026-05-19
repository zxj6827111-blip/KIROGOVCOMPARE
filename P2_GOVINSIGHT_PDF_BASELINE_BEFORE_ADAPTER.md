# P2 GovInsight PDF Baseline Before Adapter

## 1. 基线范围

- 基线目的：在开始 P2-2 adapter 改造前，冻结当前 main 上 GovInsight PDF 输出状态，作为后续对比依据。
- 测试对象：`city_721 / 2025`
- print 页面：`/print/govinsight-report/city_721/2025`
- PDF API：`/api/gov-insight/report-pdf?org_id=city_721&year=2025`
- 生成文件：`output/pdf/govinsight_city_721_2025_baseline_before_adapter.pdf`
- 文件大小：`649,395 bytes`

## 2. 当前 main commit

- 当前分支：`main`
- 当前 commit：`14b7ceb7b54a6dbbb89edee01236e9bd92406bbe`
- 远端同步检查：已执行 `git fetch origin main`；本地 `HEAD` 与 `origin/main` 一致。
- 工作区备注：存在未跟踪 `.worktrees/*` 目录，未改动。

## 3. print 页面 ready 检查结果

- 页面打开结果：成功打开 `http://127.0.0.1:3001/print/govinsight-report/city_721/2025`
- `#govinsight-report-print`：存在
- `data-govinsight-pdf-ready`：`true`
- 页面标题：`淮安市_2025_政务公开智能辅策报告`
- 章节节点数量：`11`
- 目录页码节点数量：`11`
- 浏览器控制台 warning/error：未发现

## 4. PDF 检测结果

- API 返回：`200`
- Content-Type：`application/pdf`
- Content-Length：`649395`
- PDF 页数：`19`
- 空白页：`0`
- 已使用项目现有脚本：`node scripts/pdf-smoke-baseline.js --comparison-ids=721 --file=721=output/pdf/govinsight_city_721_2025_baseline_before_adapter.pdf`
- 现有脚本结果：`ok=true`，`pageCount=19`，`blankPages=0`，`hasReplacementChar=false`，`printReadyMarkerOk=true`

## 5. 目录页码是否可信

结论：可信。

PDF 第 3 页目录列出的章节页码均能在对应 PDF 页找到章节标题：

| 目录项 | 目录页码 | 对应页是否命中标题 |
| --- | ---: | --- |
| 一 总体判断 | 4 | 是 |
| 二 重点风险事项 | 5 | 是 |
| 三 确认事实 | 7 | 是 |
| 四 审慎分析 | 8 | 是 |
| 五 三级监测重点摘要 | 9 | 是 |
| 六 待补充问题 | 11 | 是 |
| 七 整改任务清单 | 12 | 是 |
| 八 结语 | 16 | 是 |
| 附件一 指标审计与勾稽校验 | 17 | 是 |
| 附件二 使用边界与口径说明 | 18 | 是 |
| 附件三 建议补充数据 | 19 | 是 |

## 6. 页眉页脚是否正常

结论：未发现页眉页脚重叠。

- 页眉文本稳定出现于各页顶部，例如：`淮安市 2025 政务公开智能辅策报告 / 内部审阅材料`
- 页脚文本稳定出现于各页底部，例如：`供内部研判参考，不作为正式考核结论 / 第 N 页 / 共 19 页`
- 基于 `pdfjs-dist` 文本坐标抽取，页眉约在 `y=819.4`，页脚约在 `y=16.9`。
- 第 5、9、13 页等长表格页有正文内容接近页面底部或顶部安全区，但与页眉页脚固定文本坐标仍分离，未发现页码、页脚说明与正文文字直接重叠。

备注：本机未发现 `pdftoppm`、`pdfinfo`、ImageMagick 或 Ghostscript，因此本次未做像素级渲染截图比对；以上结论来自浏览器页面状态、PDF 文本抽取和文本坐标检查。

## 7. 图表是否正常

结论：未发现图表相关异常。

- print 页面中 `.recharts-surface` 数量：`0`
- print 页面中 `.recharts-responsive-container` 数量：`0`
- 零尺寸 Recharts 图表：`0`
- Recharts width/height warning：未发现

说明：当前基线的 print PDF 输出未检测到 Recharts 节点，因此本轮重点确认“没有 Recharts 尺寸 warning、没有零尺寸图表节点”。如果 P2-2 后 adapter 引入或恢复 Recharts 图表，应额外比较图表节点数量、尺寸和渲染结果。

## 8. 后续 P2-2 对比使用方式

P2-2 改造完成后，建议用同一对象和同一检查链路复测：

1. 打开 `/print/govinsight-report/city_721/2025`，确认 `#govinsight-report-print` 和 `data-govinsight-pdf-ready=true`。
2. 通过 `/api/gov-insight/report-pdf?org_id=city_721&year=2025` 重新生成 PDF。
3. 对比本基线文件：
   - PDF 页数是否仍为 `19`，或页数变化是否有明确原因；
   - 是否仍为 `0` 空白页；
   - 目录页码是否仍能命中对应章节页；
   - 页眉页脚是否仍不与正文重叠；
   - 是否新增 Recharts width/height warning；
   - 文件大小是否发生异常级变化。
4. 继续使用现有 `scripts/pdf-smoke-baseline.js` 做最小 PDF 检测；如需要视觉级验收，再补充渲染截图工具，但不应作为 P2-2 的隐式大型依赖。
