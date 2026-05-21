# P4-5 Pre-Merge Check Report

生成时间：2026-05-21

## 1. 当前分支

- 当前分支：`codex/p4-performance-security-hardening`
- base：`origin/main`

## 2. commit hash

- 当前 HEAD：`117f4a13c49b80f0041b962bedd96ae5828cfe17`
- 提交：`117f4a1 fix: harden P4 performance security and permissions`

## 3. 与 origin/main 的 diff 文件清单

```text
P4_PERFORMANCE_SECURITY_HARDENING_PLAN.md
P4_PERFORMANCE_SECURITY_HARDENING_REPORT.md
frontend/src/components/tasks/TaskDrawerProvider.js
frontend/src/components/tasks/TaskDrawerProvider.test.js
src/__tests__/dataCenterPermissions.test.ts
src/__tests__/govInsightJobStatus.test.ts
src/__tests__/pdfJobsRegression.test.ts
src/routes/data-center.ts
src/routes/gov-insight-pdf.ts
src/routes/gov-insight.ts
src/routes/pdf-export.ts
src/routes/pdf-jobs.ts
src/services/PdfExportWorker.ts
src/utils/pdfExportPath.ts
```

说明：`P4_5_PRE_MERGE_CHECK_REPORT.md` 是本阶段报告文件，生成后将作为 E 阶段补充提交加入分支。

## 4. 禁止项检查

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| schema/migration | 通过 | 未修改数据库 schema 或 migration |
| `scripts/pdf-smoke-baseline.js` | 通过 | 未修改 |
| legacy EJS 删除 | 通过 | 未删除 legacy EJS |
| 旧接口删除 | 通过 | 未删除旧接口 |
| PDF 主链路无关修改 | 通过 | 保留 `/api/pdf-jobs`、`/api/comparisons/:id/pdf`、`/api/gov-insight/report-pdf`、`/print/comparison/:id`、`/print/govinsight-report/:orgId/:year` |
| 生成物、日志、PDF、ZIP、截图、HTML dump | 通过 | 未进入 diff 或暂存区 |
| 真实 `.env`、secret、token | 通过 | 未提交 |
| P4 最终总体验收内容 | 通过 | 未开始、未提交 P4_FINAL_ACCEPTANCE |
| out-of-scope 历史报告 | 通过 | 未处理、未暂存、未提交 |

## 5. 自动验证结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm.cmd run build` | 通过 | TypeScript build 和 public copy 通过 |
| `npm.cmd test` | 通过 | 21/21 suites，154/154 tests；保留既有 JWT_SECRET、bcrypt 默认密码和 legacy EJS warning |
| `cd frontend && npm.cmd test -- --runInBand` | 通过 | 20/20 suites，98/98 tests |
| `cd frontend && npm.cmd run build` | 通过 | typecheck 和 webpack production build 通过；保留既有 asset/bundle size warning |
| `npm.cmd run smoke:pdf` | 通过 | total 4，passed 4，failed 0，skipped 0，strictLive=false |
| `git diff --check origin/main...HEAD` | 通过 | 无 whitespace error |
| `git diff --cached --name-only` | 通过 | 暂存区为空 |

## 6. strict-live 结果

已执行：

```text
npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001
```

结果：

- total：4
- passed：4
- failed：0
- skipped：0
- strictLive：true
- API：`http://127.0.0.1:8787`
- Frontend：`http://127.0.0.1:3001`
- 普通比对 PDF、长表比对 PDF、GovInsight PDF、PDF job API 均通过。
- 当前环境缺少 `pdfinfo`、`pdftoppm`、ImageMagick、Ghostscript，PDF 像素级渲染/diff 检查按既有 smoke 能力降级为 pdfjs 文本、页数、空白页和 ready marker 检查。

## 7. 是否存在 untracked/unstaged

- staged：无。
- unstaged：无 P4-5 代码或报告修改。
- untracked：仅存在已知 out-of-scope 历史报告：

```text
P3-5_POST_MERGE_HEALTH_CHECK.md
P3_FINAL_ACCEPTANCE_REPORT.md
P4_1_POST_MERGE_HEALTH_CHECK.md
P4_1_PRE_MERGE_CHECK_REPORT.md
P4_2_POST_MERGE_HEALTH_CHECK.md
P4_3_POST_MERGE_HEALTH_CHECK.md
P4_4_POST_MERGE_HEALTH_CHECK.md
```

## 8. 是否建议 push

建议 push。

理由：

- 与 `origin/main` 的 diff 仅包含 P4-5 性能、安全、权限、异常加固代码、测试和报告。
- 自动验证、PDF smoke 和 strict-live 均通过。
- 暂存区为空，未跟踪文件没有新增生成物。

## 9. 是否建议创建 PR

建议创建 PR，交给人工复核。

PR 不应自动 merge。P4-5E 完成后必须等待人工合并，合并到 main 后才能执行 P4-5F。

## 10. 是否建议合并 main

建议人工复核后合并 main。

合并前建议人工重点复核：

- data-center 区域 scope 与管理员/只读用户权限边界。
- PDF 下载、批量下载、过期文件和非法路径提示。
- TaskDrawer 轮询窗口变化对任务中心体验的影响。
- 生产环境 PDF 像素级验证工具缺失是否需要补齐。
