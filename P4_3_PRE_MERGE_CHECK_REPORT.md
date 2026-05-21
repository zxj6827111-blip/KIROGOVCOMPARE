# P4-3E 预合并检查报告

## 1. 当前分支

- 当前分支：`codex/p4-deployment-operations`
- 基准分支：`origin/main`
- 验证时 P4-3 实施 commit：`4b90e66216e0c1d042683fa2c2b279d4e2545b00`
- commit 标题：`docs: add P4 deployment operations materials`

说明：本报告在 P4-3E 验证通过后生成，并作为 P4-3 交付材料提交到当前分支。后续如仅修正本报告文字，不改变 P4-3 实施 diff 范围。

## 2. 与 origin/main 的 diff 文件清单

P4-3 最终 diff：

```text
.env.example
DEPLOYMENT.md
OPERATIONS.md
P4_3_PRE_MERGE_CHECK_REPORT.md
P4_DEPLOYMENT_OPERATIONS_PLAN.md
P4_DEPLOYMENT_OPERATIONS_REPORT.md
TROUBLESHOOTING.md
package.json
scripts/diagnostic-bundle.js
scripts/health-check.js
```

diff 统计已通过 `git diff --stat origin/main...HEAD` 检查。由于本报告本身也属于 P4-3E 交付材料，报告文字修正会改变本文件的行数统计；最终边界以本节文件清单和 `git diff --name-only origin/main...HEAD` 为准。

确认：最终 diff 只包含 P4-3 文档、P4-3 报告、运维脚本、`.env.example` 和 `package.json` scripts。

## 3. 禁止项检查

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| 业务重构 | 通过 | 未改业务组件、服务、路由主逻辑 |
| 数据库 schema/migration | 通过 | 未改 `migrations/` 或 `src/db/*` |
| 解析算法 | 通过 | 未改解析服务或 prompt 主链路 |
| 比对算法 | 通过 | 未改 comparison/consistency 计算逻辑 |
| GovInsight 生成逻辑 | 通过 | 未改 GovInsight payload、worker、模型协议 |
| PDF 后端主链路 | 通过 | 未改 `PdfExportWorker`、`BrowserRenderer`、PDF routes |
| `scripts/pdf-smoke-baseline.js` | 通过 | 未修改 |
| legacy EJS | 通过 | 未删除、未修改 |
| P4-4/P4-5 内容 | 通过 | 只固化部署运维交付能力 |
| 生成物 | 通过 | 未提交 logs、诊断包、PDF、ZIP、截图、HTML dump、build/dist/coverage/node_modules |
| 真实 `.env` / secret / token | 通过 | `.env.example` 只新增占位变量 |

## 4. 自动验证结果

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| `npm.cmd run build` | 通过 | 后端 TypeScript build 与 public copy 通过 |
| `npm.cmd test` | 通过 | 19 suites，144 tests；既有 JWT_SECRET 测试日志和 legacy EJS warning 不影响结果 |
| `cd frontend && npm.cmd test -- --runInBand` | 通过 | 20 suites，97 tests |
| `cd frontend && npm.cmd run build` | 通过 | TypeScript 与 webpack production build 通过；保留既有 asset/bundle size warning |
| `npm.cmd run smoke:pdf` | 通过 | total 4，passed 4，failed 0，skipped 0，strictLive=false |
| `npm.cmd run ops:health` | 通过 | 退出码 0；后端 `/api/health`、数据库、目录、Puppeteer 通过 |
| `npm.cmd run ops:diagnostics:dry-run` | 通过 | 只列出收集范围，不生成文件 |

`ops:health` warning：

- 前端生产默认端口 `http://127.0.0.1:53002/healthz` 当前未启动，记为 warning。
- `pdfinfo`、`pdftoppm`、ImageMagick、Ghostscript 未在 PATH，PDF 像素级视觉回归能力降级。

上述 warning 已在 `DEPLOYMENT.md`、`OPERATIONS.md`、`TROUBLESHOOTING.md` 和 `P4_DEPLOYMENT_OPERATIONS_REPORT.md` 中记录；本地 live 前端 `http://127.0.0.1:3001` 已通过 strict-live。

## 5. strict-live 结果

执行：

```powershell
npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001
```

结果：通过。

- total：4
- passed：4
- failed：0
- skipped：0
- strictLive：true
- API：`http://127.0.0.1:8787`
- 前端：`http://127.0.0.1:3001`

覆盖：

- comparison `4670` 普通 PDF。
- comparison `1143` 长表格 PDF。
- GovInsight `city_721` PDF。
- pdf-job API 创建、轮询、下载、失败任务不可下载、过期文件 410、批量 ZIP。

工具链说明：

- `pdfjs` 可用。
- `pdfinfo`、`pdftoppm`、ImageMagick、Ghostscript 当前不可用。
- 像素级视觉回归按既有 smoke 逻辑降级为文本、页数、空白页和 ready marker 检查。

## 6. 新增脚本验证结果

| 脚本 | 结果 | 说明 |
| --- | --- | --- |
| `node -c scripts/health-check.js` | 通过 | 语法检查通过 |
| `node -c scripts/diagnostic-bundle.js` | 通过 | 语法检查通过 |
| `npm.cmd run ops:health -- --skip-network` | 通过 | 跳过网络，数据库、目录、Puppeteer 通过；PDF 原生工具缺失为 warning |
| `npm.cmd run ops:health` | 通过 | 后端 `/api/health` 通过；前端生产 `53002` 未启动为 warning |
| `npm.cmd run ops:diagnostics:dry-run` | 通过 | dry-run 无生成物 |
| `npm.cmd run ops:diagnostics` | 通过 | 生成到 `.codex-temp/diagnostics/kirogovcompare-diagnostic-*`，未进入 Git |

## 7. untracked / unstaged 状态

E 阶段检查时：

- staged：空。
- tracked unstaged：无。
- untracked：仅以下已知 out-of-scope 历史报告文件。

```text
P3-5_POST_MERGE_HEALTH_CHECK.md
P3_FINAL_ACCEPTANCE_REPORT.md
P4_1_POST_MERGE_HEALTH_CHECK.md
P4_1_PRE_MERGE_CHECK_REPORT.md
P4_2_POST_MERGE_HEALTH_CHECK.md
```

说明：这些文件按任务要求不处理、不暂存、不提交。

生成物排除确认：

- `.codex-temp/diagnostics/` 未出现在 `git ls-files --others --exclude-standard`。
- `data/exports/pdf` PDF 产物未进入 Git。
- `frontend/build` 和 `dist` 未进入 Git。
- 未发现 logs、ZIP、截图、HTML dump、coverage 或 node_modules 进入可提交范围。

## 8. 是否建议 push

建议 push。

理由：

- P4-3A 到 P4-3D 门禁已通过。
- P4-3E 边界检查通过。
- 自动验证、PDF smoke、strict-live、新增脚本验证通过。
- diff 范围属于 P4-3 部署运维交付能力。
- 未提交禁止项或生成物。

## 9. 是否建议创建 PR

建议创建 PR，供人工复核。

建议 PR 标题：

```text
docs: add P4 deployment operations materials
```

建议 PR 重点复核：

- `DEPLOYMENT.md` 是否符合目标部署环境。
- `OPERATIONS.md` 的备份恢复和清理策略是否符合现场制度。
- `TROUBLESHOOTING.md` 的排障口径是否足够克制。
- `scripts/health-check.js` 和 `scripts/diagnostic-bundle.js` 是否符合安全边界。

## 10. 是否建议合并 main

建议人工复核通过后合并到 `main`。

限制：

- 不自动 merge。
- P4-3F 只能在人工确认 P4-3 已合并到 `main` 后执行。
- 合并前仍建议人工确认 PDF 原生视觉工具链 warning 是否接受，或在验收机补齐 Poppler/ImageMagick/Ghostscript 后复跑 smoke。

## 11. 结论

P4-3E 预合并检查通过。可以 push 当前分支并创建 PR，交给人工复核和人工合并。

P4-3E 完成后必须停止，等待人工合并后才能执行 P4-3F。
