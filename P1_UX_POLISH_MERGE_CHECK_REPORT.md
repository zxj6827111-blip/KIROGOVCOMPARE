# P1 UX Polish Merge Check Report

## 1. 测试数量减少原因

本轮 `frontend/npm.cmd test` 显示 `13 suites / 62 tests`，上一轮 `P1_ACCEPTANCE_AND_FIX_REPORT.md` 记录为 `14 suites / 67 tests`。差异原因不是本轮误删或跳过测试，而是分支基线不同。

证据：

- 当前分支 `codex/p1-ux-polish-failure-states` 基于 `origin/main`，当前 `HEAD` 与 `origin/main` 均为 `732d16e` 起点。
- 当前分支和 `origin/main` 的前端测试文件清单都是 13 个。
- 本地 `main` 比 `origin/main` 多两个提交，其中 `662dc31 Complete P1 report flow export panel` 新增了 `frontend/src/components/ReportFlowStatusBar.test.js`。
- `ReportFlowStatusBar.test.js` 内包含 5 个 `test(...)`，正好对应上一轮多出的 `1 suite / 5 tests`。
- `P1_ACCEPTANCE_AND_FIX_REPORT.md` 属于本地 `main` 上的 `662dc31` 提交，不在当前 P1 UX polish 分支和 `origin/main` 基线中。

因此：`14/67 -> 13/62` 是因为上一轮报告引用的是本地 `main` 上尚未进入 `origin/main` 的 P1 report-flow/export-panel 测试；本轮分支从最新 `origin/main` 创建，天然不包含该测试文件。

## 2. 是否有误删 / 误跳过测试

结论：没有发现误删、误跳过或 `.only` 限制。

检查结果：

- `git diff -- frontend/src -- '*test*'`：未发现本轮对测试文件的删除或实质修改。
- 精确测试文件 diff：`git diff --name-status -- 'frontend/src/**/*.test.*' 'frontend/src/**/*.spec.*'` 为空。
- `git grep -n "describe.only\\|it.only\\|test.only\\|describe.skip\\|it.skip\\|test.skip" frontend/src`：无命中。
- `frontend/package.json` 的测试命令仍为 `jest --runInBand`。
- `frontend/jest.config.js` 仍使用 `roots: ['<rootDir>/src']`，未改变测试发现规则。
- 本轮修改文件清单中没有任何 `*.test.*` 或 `*.spec.*` 文件。

不需要恢复测试文件。若后续要把上一轮 `ReportFlowStatusBar.test.js` 带入本分支，应先把对应 P1 report-flow/export-panel 功能提交合入当前基线；这已经超出本轮“不新增功能、不进入 P2”的终检范围。

## 3. 未跟踪文件检查结果

`git status --short` 显示本轮业务变更和以下未跟踪文件：

- `.worktrees/annual-report-parse-fallback-fix/`
- `.worktrees/ocr-partial-correction-fix-clean/`
- `.worktrees/pr88-resolve/`
- `P1_UX_POLISH_FAILURE_STATES_REPORT.md`
- `P1_UX_POLISH_MERGE_CHECK_REPORT.md`
- `frontend/src/govinsight/components/StableChartFrame.tsx`
- `scripts/pdf-smoke-baseline.js`

检查结论：

- `.worktrees/*` 是既有本地 worktree 残留目录，不属于本轮交付，不能提交。
- 未发现新的未跟踪 PDF、截图、测试输出、coverage、playwright-report 或临时结果文件需要提交。
- 当前没有 staged 文件，未发生误暂存。
- `P1_UX_POLISH_FAILURE_STATES_REPORT.md`、`P1_UX_POLISH_MERGE_CHECK_REPORT.md`、`StableChartFrame.tsx`、`scripts/pdf-smoke-baseline.js` 是本轮应纳入审阅的新增交付文件。

## 4. package / smoke 脚本检查

- `package.json` 新增 `"smoke:pdf": "node scripts/pdf-smoke-baseline.js"`，必要且已验证可运行。
- `scripts/pdf-smoke-baseline.js` 不依赖本地绝对路径：
  - 显式 `--file=<comparison_id>=<pdf_path>` 支持绝对路径和相对路径；
  - 相对路径通过 `path.resolve(process.cwd(), value)` 解析；
  - 默认模式从数据库查询最新 `pdf_export` job 的 `file_path`；
  - 未写死 `E:\Software Development\KIROGOVCOMPARE` 或用户目录。
- 脚本复用已有 `pdfjs-dist`，未引入大型依赖。
- 脚本中的 `�` 检查实际为 Unicode replacement character `U+FFFD`，不是终端显示乱码。

## 5. errorTranslator 共用检查

`frontend/src/utils/errorTranslator.js` 当前被以下入口共用：

- 任务中心：`frontend/src/components/JobCenter.js`
- 任务详情：`frontend/src/components/JobDetail.js`
- Toast 错误展示 detail：`frontend/src/components/common/ToastProvider.js`
- 打印页：`frontend/src/components/print/ComparisonPrintView.js`
- 比对详情 PDF 任务创建：`frontend/src/components/ComparisonDetailView.js`
- 比对历史 PDF 任务创建：`frontend/src/components/ComparisonHistory.js`
- GovInsight 导出失败：`frontend/src/govinsight/views/ReportGenerator.tsx`

符合“任务中心、Toast、ExportPanel/导出入口、打印页显示统一友好文案，并保留原始错误详情”的本轮目标。

## 6. build / test / smoke 结果

已执行用户指定命令：

| 命令 | 结果 |
| --- | --- |
| `git diff --name-only` | 仅显示本轮前端 UX、GovInsight 图表、PDF smoke 脚本和 `package.json` 改动；无测试文件改动 |
| `git diff -- frontend/src -- '*test*'` | 未发现测试删除；精确测试文件 diff 为空 |
| `git grep -n "...only/skip..." frontend/src` | 无命中 |
| `frontend/npm.cmd test -- --watchAll=false` | 通过，13 suites / 62 tests |
| `npm.cmd test` | 通过，18 suites / 137 tests |
| `npm.cmd run build` | 通过 |
| `frontend/npm.cmd run build` | 通过，仅有既有 webpack asset size warning |
| `frontend/npm.cmd test` | 通过，13 suites / 62 tests |
| `npm.cmd run smoke:pdf` | 通过 |

PDF smoke 结果：

| comparison_id | 页数 | 空白页 | replacement char | print ready | 结果 |
| --- | ---: | ---: | --- | --- | --- |
| `4670` | 13 | 0 | 无 | 正常 | 通过 |
| `1143` | 13 | 0 | 无 | 正常 | 通过 |

## 7. 是否建议合并

建议合并，但提交时必须排除 `.worktrees/*`。

理由：

- 测试数量减少已确认是分支基线差异，不是误删、误跳过或命令/环境变化。
- 本轮没有修改测试发现规则。
- 所有指定 build、test、smoke 均通过。
- `smoke:pdf` 脚本可运行且无本机绝对路径依赖。
- 本轮改动仍保持 P1 边界，没有新增 P2 架构重构。

## 8. 是否仍有阻断项

无合并阻断项。

非阻断注意事项：

- `.worktrees/*` 仍是未跟踪目录，提交时不要 stage。
- 前端 build 的 asset size warning 是既有体积 warning，本轮未处理。
- 后端测试日志中的 `JWT_SECRET` 和 bcrypt migration warning 为既有测试日志，不影响测试通过。
