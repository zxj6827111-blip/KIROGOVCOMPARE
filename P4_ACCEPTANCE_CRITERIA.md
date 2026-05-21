# P4 验收标准

## 1. 使用范围

本文档用于 P4 阶段客户演示、专家评审和阶段验收确认。验收对象是当前已合并到 main 的 P4-1、P4-2、P4-3 能力，以及 P4-4 形成的演示与验收材料。

本标准不代表新增业务功能。本阶段不修改业务代码、数据库 schema/migration、解析算法、比对算法、GovInsight 生成逻辑、PDF 后端主链路、部署运维脚本、`scripts/pdf-smoke-baseline.js` 或 legacy EJS。

## 2. 验收前提

- 验收环境应明确后端 API 地址、前端地址、数据库连接和登录账号。
- 验收前应执行构建、测试和 `npm.cmd run smoke:pdf`。
- 如本地 API `http://127.0.0.1:8787` 和前端 `http://127.0.0.1:3001` 同时可用，应执行 strict-live PDF smoke。
- 如 strict-live 所需服务未启动，应记录为 blocked，不得写成通过。
- 不得使用生产 secret、真实 `.env` 值或敏感 token 作为验收材料附件。

## 3. 功能验收

| 验收项 | 验收标准 | 建议证据 |
| --- | --- | --- |
| 登录 | 未登录访问业务页进入登录流程；已登录用户可进入授权范围内页面 | 页面截图或现场操作记录；接口 401/403 记录 |
| 年报工作台 | 可查看地区、年份、报告列表和报告详情入口 | `/catalog`、`/catalog/reports/:reportId` 操作记录 |
| 上传 | 可上传年度报告文件并创建解析任务 | `/upload` 操作记录；解析 job id |
| 解析任务 | 任务中心可查看排队、处理中、成功、失败等状态 | `/jobs` 页面记录；`/api/jobs` 响应摘要 |
| 复核 | 报告详情可查看勾稽检查、问题项、证据说明和定位信息 | 报告详情页记录；P4-2 evidence 证据 |
| 发布 | 无阻断问题的报告可进入发布链路；存在 open issue 的报告应被阻断 | P4-1 report `4691`、`4837`、`4839` 样本记录 |
| 比对 | 可基于已入库并发布的报告查看比对历史和详情 | comparison `4670`、`1143` 记录 |
| 问题复核 | 可从问题列表或报告详情查看异常项并进行人工复核 | `/issues/*`、报告详情页记录 |
| 用户和地区管理 | 具备相应权限的用户可进入管理入口 | `/regions`、`/admin/users` 访问记录 |

不通过判定：

- 核心业务页无法登录后访问，且不是环境、账号或权限配置问题。
- 上传后不能创建解析任务，或任务状态长期不可见。
- 报告详情无法查看复核信息，导致人工无法确认数据。
- 比对详情无法打开已知有效 comparison。

## 4. 数据验收

| 验收项 | 验收标准 | 建议证据 |
| --- | --- | --- |
| 地区与年份 | 报告按地区和年份归档，能定位到具体单位 | 报告详情基础信息 |
| 结构化字段 | 解析后的字段可用于勾稽检查、比对和报告展示 | 报告详情字段展示 |
| 状态流转 | 报告版本、解析任务、复核状态和发布状态清晰 | job、report version、review status 摘要 |
| 数据范围 | 非授权地区数据不可被越权访问 | P4-1 权限边界样本；403/404 记录 |
| 异常数据 | 缺表、表头不足、跨页、长表格截断等风险不伪造成确定数据 | P4-2 evidence helper 展示 |

不通过判定：

- 报告地区、年份或单位归属明显错乱且无法人工纠正。
- 系统把不可评估或高风险数据直接当作确定通过项。
- 权限范围外的数据可被普通用户直接读取。

## 5. 真实样本验收

建议使用 P4-1 已验证样本作为验收主样本：

| 样本 | 用途 | 验收关注点 |
| --- | --- | --- |
| report `4691` / version `4314` | 淮安市发改委 2024，上传/解析复用样本 | 上传、解析、复核、发布链路 |
| report `4837` / version `4457` | 生态文旅区 2025，复杂表三样本 | 复杂表格解析和复核 |
| report `4839` / version `4405` | 洋河新区 2025，异常/缺表样本 | 发布阻断和异常样本处理 |
| comparison `4670` | 淮安市 2024-2025 | 比对详情、PDF 导出、异常提示 |
| comparison `1143` | 清江浦区工信局 2024-2025 | 长表格比对和 PDF 样本 |
| `city_721` / `721`, year `2025` | GovInsight 淮安市 2025 | 已存报告、payload 来源、PDF 输出 |

验收标准：

- 真实样本能覆盖上传、解析、复核、发布、比对、PDF、GovInsight、任务中心的主要路径。
- 对 P4-1 已记录的遗留问题，应按既有边界说明，不得临场宣称已修复。
- 不重复制造无必要的 compare job 或 PDF 生成物，除非验收明确要求现场触发。

## 6. 异常样本验收

| 异常类型 | 验收标准 | 建议样本或证据 |
| --- | --- | --- |
| 缺表/结构异常 | 系统应提示风险或阻断发布，不应静默通过 | report `4839` |
| 解析失败 | 任务中心显示失败状态和可读错误原因 | `/jobs` 失败任务 |
| PDF 未完成 | 下载接口返回未就绪状态，不提供错误文件 | failed PDF job `18396` |
| PDF 文件过期 | 下载返回过期提示，支持重新生成入口 | expired PDF job `18278` |
| GovInsight latest job 失败 | 已存报告和 PDF 可用，但最新生成失败应如实说明 | P4-1 issue `P4-1-001` |

不通过判定：

- 异常样本被错误发布，且没有复核提示。
- PDF 未完成或已过期时仍返回损坏文件。
- GovInsight 失败任务被材料描述成“全部生成链路已稳定通过”。

## 7. 数据质量与证据链验收

验收标准：

- 报告详情和勾稽检查中可查看“证据说明”。
- `FAIL`、`UNCERTAIN`、`NOT_ASSESSABLE` 项应能展示字段路径、风险原因或来源线索。
- 无更详细来源时，应保守显示“暂无更详细来源，仅保留结构化字段路径”等口径，不伪造页码、表格坐标、OCR 原文或人工结论。
- GovInsight 打印页可展示已有来源状态，例如 `payloadSource`、`materializeStatus`、`sourceJobId`、`sourceReportVersionId` 和 `dataQuality` 摘要。

建议证据：

- `P4_DATA_QUALITY_EVIDENCE_REPORT.md`
- `/catalog/reports/3670` 页面抽查记录
- `/comparison/4670` 差异来源说明
- `/print/govinsight-report/city_721/2025`
- `/print/govinsight-report/721/2025`

不通过判定：

- 数据质量风险完全不可见，导致专家无法追问来源。
- 不可评估项被写成明确通过。
- 材料承诺了系统没有保存的页码、坐标或 OCR 原文。

## 8. PDF 导出验收

验收标准：

- comparison PDF 可创建导出任务、轮询状态、下载文件。
- 长表格 comparison PDF 可通过 smoke 检查。
- GovInsight PDF 可通过 smoke 检查。
- PDF job API 应覆盖创建、完成、下载、失败任务拒绝下载、过期文件 410、批量 ZIP 下载。
- legacy EJS 兼容路径可保留，但不得作为推荐主路径；推荐主路径是 `/api/pdf-jobs` 和 React 打印页。
- 当前环境如缺少 `pdfinfo`、`pdftoppm`、ImageMagick、Ghostscript，应明确 PDF 像素级视觉检查降级，不写成像素级检查已通过。

建议证据：

- `P4_REAL_SAMPLE_REGRESSION_REPORT.md`
- `P4_DEPLOYMENT_OPERATIONS_REPORT.md`
- `npm.cmd run smoke:pdf` 输出
- strict-live 输出或 blocked 说明

不通过判定：

- 已完成 PDF job 无法下载，且不是权限、过期或环境原因。
- 失败/过期 PDF job 返回错误文件而不是明确错误。
- 材料把降级 smoke 描述成完整像素级视觉回归。

## 9. GovInsight 验收

验收标准：

- GovInsight 页面和打印视图可访问。
- 已存报告、payload、来源状态和 PDF 输出可用于演示。
- numeric orgId 和 canonical orgId 的打印路径保持兼容。
- 最新生成任务失败时，应如实说明其为已知遗留问题，不影响当前已存报告和 PDF，但不适合作为现场重新生成演示项。

建议证据：

- `/api/gov-insight/annual-data?org_id=city_721&year=2025`
- `/api/gov-insight/ai-report?org_id=city_721&year=2025`
- `/api/gov-insight/ai-report/payload?org_id=city_721&year=2025`
- `/api/gov-insight/report-pdf?org_id=city_721&year=2025`
- `/print/govinsight-report/city_721/2025`

不通过判定：

- 已存 GovInsight 报告无法打开，且不是数据或环境缺失。
- PDF 输出不可用。
- 验收材料隐瞒 latest job `17` failed 的已知边界。

## 10. TaskDrawer 和任务中心验收

验收标准：

- 上传链路可通过 TaskDrawer 或任务中心观察解析任务。
- 比对/PDF 链路可通过 TaskDrawer 或下载任务中心观察 PDF 导出任务。
- `/jobs` 可查看上传解析任务。
- `/jobs?tab=download` 可查看 PDF 导出任务、可下载数量、生成中、失败、已过期状态。
- 批量下载仅打包“已完成且文件未过期”的 PDF 任务。
- TaskDrawer 人工可视化仍建议使用真实登录账号补做，不得把工具限制下未完成的可视化点击写成已完成。

建议证据：

- `P4_REAL_SAMPLE_REGRESSION_REPORT.md` 的 TaskDrawer 观察。
- `OPERATIONS.md` 的 TaskDrawer 人工验收流程。
- `/jobs` 与 `/jobs?tab=download` 页面记录。

不通过判定：

- 解析或 PDF 任务无法在任何任务入口被追踪。
- 下载任务中心无法区分完成、生成中、失败和过期状态。
- 批量下载包含未完成或已过期文件，导致用户拿到错误包。

## 11. 权限验收

验收标准：

- 未登录用户访问受保护业务 API 返回 401。
- 登录用户访问权限外数据返回拒绝或不可见。
- 管理入口根据权限键控制：`manage_regions`、`manage_users`。
- 数据范围按用户 `dataScope.regions` 递归解析地区及下级地区。
- 管理员默认权限仅用于初始化/引导口径，不作为运行时绕过。

建议证据：

- P4-1 权限边界：admin、`huaian`、未登录样本。
- `/api/auth`、受保护业务 API 的 401/403 记录。
- 管理入口可见性和不可见性记录。

不通过判定：

- 未登录可访问受保护业务数据。
- 普通用户可访问明确超出数据范围的地区报告、比对或 PDF。
- 无对应权限仍可进入用户或地区管理。

## 12. 运维验收

验收标准：

- `DEPLOYMENT.md`、`OPERATIONS.md`、`TROUBLESHOOTING.md` 存在且可读。
- `npm.cmd run ops:health` 可用于健康巡检；默认模式可把前端未启动、PDF 原生工具缺失等非阻断项显示为 warning。
- `npm.cmd run ops:diagnostics:dry-run` 可说明诊断包范围，实际诊断包不得提交。
- 备份恢复、回滚、日志、临时文件清理、PDF 工具链和 TaskDrawer 人工验收流程有文档说明。

建议证据：

- `P4_DEPLOYMENT_OPERATIONS_REPORT.md`
- `DEPLOYMENT.md`
- `OPERATIONS.md`
- `TROUBLESHOOTING.md`
- P4-3 合并后健康检查报告

不通过判定：

- 缺少部署或运维主文档，导致交付后无法巡检。
- 诊断包、日志、PDF、ZIP、截图、真实 `.env` 或 secret 被纳入 Git。
- 恢复和回滚材料把高风险操作写成可无人值守执行。

## 13. 性能与安全验收引用边界

P4-4 不做性能、安全或权限加固开发，只引用当前已有能力和验证证据：

- 性能：仅以当前构建、测试、PDF smoke 和真实样本操作结果作为阶段可用性证据，不承诺压测指标。
- 安全：仅以现有登录、权限键、数据范围、CORS、限流、secret 不输出、诊断包脱敏规则作为当前边界，不宣称完成全面安全加固。
- 权限：验收当前权限控制行为，不新增权限模型。
- 后续若需要压测、渗透测试、安全加固或权限细化，应作为独立阶段处理，不纳入 P4-4 通过条件。

不通过判定：

- 验收材料把未执行的压测或安全测试写成已通过。
- 验收材料把 P4-5 性能/安全加固描述为 P4-4 已完成工作。

## 14. 不通过判定汇总

任一情况出现时，应暂停验收或记录为不通过：

- 核心业务主链路无法完成登录、查看报告、上传、解析、复核、发布、比对或 PDF 导出。
- 真实样本证据与材料描述明显不一致。
- 异常样本被静默当作正常样本。
- 数据质量与证据链材料承诺了系统没有保存的来源信息。
- strict-live 未执行却被写成通过。
- 生成物、日志、诊断包、PDF、ZIP、截图、真实 `.env` 或 secret 进入 Git。
- 材料包含 P4-5 性能、安全、权限加固已完成的错误承诺。
- 材料引用不存在的文件或路径作为验收证据。

## 15. 验收证据材料清单

建议验收归档以下材料：

- `P4_ACCEPTANCE_CRITERIA.md`
- `P4_DEMO_SCRIPT.md`
- `P4_USER_MANUAL_DRAFT.md`
- `P4_EXPERT_REVIEW_QA.md`
- `P4_ACCEPTANCE_DEMO_MATERIALS_REPORT.md`
- `P4_REAL_SAMPLE_REGRESSION_REPORT.md`
- `P4_REAL_SAMPLE_ISSUE_LIST.md`
- `P4_DATA_QUALITY_EVIDENCE_REPORT.md`
- `P4_DEPLOYMENT_OPERATIONS_REPORT.md`
- `P4_1_POST_MERGE_HEALTH_CHECK.md`
- `P4_2_POST_MERGE_HEALTH_CHECK.md`
- `P4_3_POST_MERGE_HEALTH_CHECK.md`
- `DEPLOYMENT.md`
- `OPERATIONS.md`
- `TROUBLESHOOTING.md`
- 本次 P4-4 自动验证输出摘要
- strict-live 输出或 blocked 原因记录

## 16. 验收人签字/确认建议字段

| 字段 | 填写说明 |
| --- | --- |
| 项目名称 | KIROGOVCOMPARE 政府信息公开年报差异比对系统 |
| 验收阶段 | P4 客户演示与验收材料 |
| 验收环境 | API 地址、前端地址、数据库环境、浏览器环境 |
| 验收日期 | 实际验收日期 |
| 验收样本 | report id、version id、comparison id、GovInsight org/year |
| 自动验证结果 | build、test、frontend test、frontend build、smoke:pdf、strict-live |
| 业务验收结论 | 通过 / 有条件通过 / 不通过 |
| 专家验收结论 | 通过 / 有条件通过 / 不通过 |
| 遗留问题确认 | 已知遗留问题、影响范围、是否阻塞 |
| 客户代表 | 姓名、单位、签字或邮件确认 |
| 专家代表 | 姓名、单位、签字或邮件确认 |
| 项目负责人 | 姓名、单位、签字或邮件确认 |
| 备注 | 补充说明、后续阶段建议 |
