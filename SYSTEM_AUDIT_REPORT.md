# 年报比对系统审计报告

**审计日期：** 2026-05-17  
**审计对象：** `E:\Software Development\KIROGOVCOMPARE`  
**审计方式：** 基于当前仓库代码的静态复核  
**说明：** 本版已删除原稿中证据不足、定性过重、或已被当前代码修复的结论，仅保留当前代码能够直接证实、且适合进入整改清单的问题。

---

## 1. 执行结论

当前系统**不是“整体不可交付”**，但确实存在一批需要按优先级处理的问题。

本次复核后，建议保留并推进整改的问题主要集中在五类：

1. 用户可见业务缺陷  
   代表问题：表三前端将 `null` 强制显示为 `0`。

2. 鉴权与权限边界问题  
   代表问题：`NODE_ENV=test` 直接绕过鉴权、`id=1` 超管硬编码绕过权限。

3. SQL 构造与接口安全设计问题  
   代表问题：`dataScope.ts` 使用动态 SQL 拼接；默认密码迁移端点设计偏脆弱。

4. 迁移机制与历史遗留实现问题  
   代表问题：迁移机制双轨、缺少真实 down migration；旧版 Compare 任务管线需要明确下线。

5. 前端调试暴露与硬编码问题  
   代表问题：`?debug=true` 技术排查面板、`window.diagnoseDistrictData`、年份和城市硬编码。

本版结论中：

- **P0** 只保留一个：表三 `null -> 0` 展示错误。
- 其余问题按实际攻击面、可利用性和用户影响降为 **P1 / P2 / P3**。

---

## 2. 本版已剔除或降级的原结论

以下内容**不再作为当前缺陷**保留在最终整改清单中：

### 2.1 OcrCorrectionService 会导致 stale facts

该结论已过时。当前代码中，`OcrCorrectionService` 在确认修正后会自动执行：

1. `materializeService.materializeVersion(versionId)`
2. `consistencyCheckService.runAndPersist(...)`
3. `visionReviewService.enqueueForConsistencyItems(...)`

因此“确认 OCR 修正后 facts 不会自动同步”这一条不再成立。

### 2.2 `admin123` 是可直接暴力破解的默认登录口令

该结论定性过重。`admin123` 当前出现在 `reset-default-password` 迁移端点中，而不是正常登录校验路径。该端点还受以下条件限制：

1. `ADMIN_BOOTSTRAP_TOKEN` 必须存在且长度足够。
2. 请求中的 `bootstrapToken` 必须匹配。
3. 用户名必须是 `admin`。

因此它仍然是一个**需要整改的安全设计问题**，但不应被写成“当前登录口令可被直接暴力破解”。

### 2.3 `dataScope.ts` 属于开放式任意 SQL 注入

该结论定性过重。当前实现确实不应继续保留，因为它使用了动态 SQL 拼接；但它并非开放式匿名输入点，且已有单引号转义。更准确的定性应为：

- **不安全的 SQL 构造方式**
- **应改为参数化查询**
- **属于安全边界和可维护性问题**

### 2.4 “系统整体零测试覆盖”

该结论不成立。仓库内已有后端和前端单元测试，但：

- 路由级 API 测试不足
- 报告生成全链路自动化验证不足
- 某些测试脚本缺少对应测试集

因此本版改写为“测试结构不完整”，而不是“整体零覆盖”。

### 2.5 未挂载路由直接视为线上漏洞

该结论不保留。未挂载或不可达的路由应归类为：

- 死代码
- 遗留代码
- 潜在误导代码

除非运行态再次确认其可达，否则不直接作为线上活跃漏洞处理。

---

## 3. 已确认问题清单

以下问题均已由当前代码直接证实。

| 编号 | 级别 | 类型 | 问题 | 证据位置 | 结论 |
|------|------|------|------|----------|------|
| A1 | P0 | 用户可见业务缺陷 | 表三前端将 `null/undefined/""` 强制显示为 `0` | `frontend/src/components/TableViews.js:405,412,417,422,427` | 当前最明确、最直接影响用户判断的问题 |
| A2 | P1 | 安全边界问题 | `NODE_ENV=test` 时直接注入全权限测试用户 | `src/middleware/auth.ts:129-138` | 生产环境误设会导致鉴权完全失效 |
| A3 | P1 | 架构/权限问题 | `id=1` 用户绕过权限检查 | `src/middleware/auth.ts:235` | 不是认证绕过，但属于权限模型硬编码 |
| A4 | P2 | 安全边界问题 | token 签名比较未使用 timing-safe 比较 | `src/middleware/auth.ts:79` | 理论风险成立，实际利用难度较高 |
| A5 | P2 | 安全边界问题 | `dataScope.ts` 使用动态 SQL 拼接 | `src/utils/dataScope.ts:13-24` | 应改为参数化查询 |
| A6 | P2 | 安全设计问题 | `reset-default-password` 迁移端点保留 `admin123` 逻辑 | `src/routes/auth.ts:68-121` | 应替换为更稳妥的一次性迁移机制 |
| A7 | P1 | 迁移/发布风险 | `migrations.ts` 只读取 `migrations/` 根目录，`migrations/postgres/` 不会被自动执行 | `src/db/migrations.ts:10-16` | 迁移 source of truth 分裂 |
| A8 | P2 | 迁移/发布风险 | 当前仍缺少真实 down migration | `src/db/migrations.ts`, `src/db/migrations-llm.ts` | 本轮已统一入口并阻断伪回滚；后续若需要可回退发布，仍需单独设计 down migration 或恢复手册 |
| A9 | P2 | 遗留功能 | 旧版 `/api/v1/tasks/compare/*` 任务管线已不属于当前主线 Compare | `src/routes/retired-compare-tasks.ts` | 本轮已物理清理旧实现，仅保留 410 退役防线；当前可用的 `/api/comparisons/*` 主线 Compare 保留 |
| A10 | P2 | 遗留 stub | `ParsedDataStorageService` 已物理删除 | `src/services/ParsedDataStorageService.ts` | 不再作为用户可用能力暴露 |
| A11 | P2 | 遗留 stub | `StructuringService` 已物理删除 | `src/services/StructuringService.ts` | 不再作为用户可用能力暴露 |
| A12 | P2 | 调试暴露面 | `window.diagnoseDistrictData` 无条件挂载到浏览器全局对象 | `frontend/src/govinsight/utils/diagnose.ts:84-86` | 生产构建中默认存在 |
| A13 | P2 | 调试暴露面 | `?debug=true` 打开技术排查面板并显示内部信息 | `frontend/src/components/ReportDetail.js:1062-1064` | 应限制到开发环境 |
| A14 | P2 | 用户可见缺陷 | 雷达图硬编码 `year=2024` | `frontend/src/govinsight/components/ReportCharts.tsx:518` | 非 2024 数据无法正确展示 |
| A15 | P3 | 可维护性问题 | LeaderCockpit 默认城市、默认年份、任务模式写死 | `frontend/src/govinsight/leader-cockpit/config.ts:4-10` | 多城市部署和真实环境切换易出错 |
| A16 | P3 | 可维护性问题 | `city_nanjing` 父子关系特判 | `frontend/src/govinsight/services/apiService.ts:59` | 典型临时逻辑未清理 |
| A17 | P2 | 调试/日志问题 | 服务端残留调试日志和内容 preview 输出 | `src/services/ReportUploadService.ts:308,321`, `src/services/GeminiLlmProvider.ts:450-456` | 应限制日志内容和环境 |
| A18 | P2 | 测试结构问题 | 路由级 API 测试缺失，现有测试主要集中在服务层和前端组件 | `src/__tests__/`, `frontend/src/**/*.test.*`, `package.json` | 风险在于接口回归不易被自动发现 |
| A19 | P3 | 文档问题 | `API.md` 明显过时，无法作为当前接口真实说明 | `API.md` | 应补最小可用接口文档 |

---

## 4. 问题分析与整改建议

### 4.1 P0：表三前端 `null -> 0`

**问题描述**

表三展示逻辑在多个取值路径上使用 `|| 0`，会把：

- `null`
- `undefined`
- 空字符串

统一压成 `0`。

这会直接破坏后端对以下语义的区分：

- 缺失值
- 空值
- 实际数值 0

**影响**

- 用户看到的页面结论会失真。
- 审计类、核对类、复盘类场景会直接误读。
- 这是最明显的“页面可感知”问题，应优先修复。

**整改要求**

1. 将 `frontend/src/components/TableViews.js` 中相关 `|| 0` 逻辑改为可区分 `null` 与 `0` 的写法。
2. 明确前端展示规范：
   - `null / undefined / ""` 显示为 `"-"` 或空态占位
   - `0` 显示为 `"0"`
   - `"/"`、`"不适用"` 保持原样
3. 增加对应前端测试，覆盖：
   - `null`
   - `undefined`
   - `""`
   - `0`
   - `"/"`
   - `"不适用"`

**验收标准**

- 表三页面不再出现“缺失值显示成 0”。
- 回归不影响表四和 diff 视图。

### 4.2 P1：鉴权测试旁路

**问题描述**

`authMiddleware` 中对 `NODE_ENV === 'test'` 的判断会直接注入一个全权限用户。

**影响**

- 一旦环境变量误设，系统鉴权会被整体绕过。

**整改要求**

1. 不允许单独依赖 `NODE_ENV=test` 触发旁路。
2. 增加额外开关，例如 `ALLOW_TEST_AUTH=1`。
3. 限定仅在测试环境、且显式开启时才允许跳过鉴权。

**验收标准**

- 仅设置 `NODE_ENV=test` 不再足以绕过鉴权。

### 4.3 P1：`id=1` 超管硬编码绕过

**问题描述**

`requirePermission()` 中存在 `req.user.id === 1 || hasPerm`。

**影响**

- 权限模型与用户 ID 绑定，不利于后续权限治理。

**整改要求**

1. 删除对 `id===1` 的硬编码特殊分支。
2. 改为角色或权限字段驱动。

**验收标准**

- 不再依赖固定用户 ID 表达超管权限。

### 4.4 P2：`dataScope.ts` 动态 SQL 拼接

**问题描述**

当前实现通过字符串拼接构造 `IN (...)` 查询。

**影响**

- 不安全的 SQL 构造方式。
- 后续维护和输入边界控制困难。

**整改要求**

1. 改为参数化查询或数组绑定。
2. 不再手工拼接 region name 列表。

**验收标准**

- 代码中不再出现将 `dataScope.regions` 直接拼进 SQL 字符串的逻辑。

### 4.5 P2：默认密码迁移端点设计偏脆弱

**问题描述**

`reset-default-password` 仍依赖硬编码 `admin123` 和 bootstrap token。

**影响**

- 安全设计复杂且脆弱。
- 容易给后续维护者错误心智模型。

**整改要求**

1. 移除硬编码 `admin123`。
2. 改为一次性迁移票据或数据库状态驱动的初始化流程。
3. 给该端点增加清晰的生命周期说明，必要时在迁移完成后禁用。

**验收标准**

- 代码中不再出现 `admin123` 常量。

### 4.6 P1/P2：迁移机制双轨和回滚边界

**问题描述**

当前至少存在三套迁移/建表来源：

1. `src/db/migrations.ts`
2. `src/db/migrations-llm.ts`
3. `migrations/postgres/*.sql`

其中 `migrations.ts` 不会自动执行 `migrations/postgres/`。

**影响**

- 环境初始化结果可能不一致。
- 人工迁移和代码迁移易漂移。

**本轮处理状态**

当前分支已完成低风险收口：

1. `src/index-llm.ts`、`scripts/apply_migration_fix.ts`、`scripts/govinsight-phase1-bootstrap.ts` 统一走 `runMigrations()`。
2. `runMigrations()` 继续调用 `runLLMMigrations()`，不改变实际建表内容。
3. 新增 `schema_migration_ledger`，记录 forward migration 和被阻断的 rollback 请求。
4. `rollbackMigration()` 不再假装删除迁移记录就是回滚，而是记录 `rollback_blocked` 后明确失败。

**剩余边界**

这不是完整 down migration 体系。若未来需要“数据库升级后可一键回退”，应单独设计每个版本的 down script、备份策略和恢复演练。

**整改要求**

1. 明确哪一套才是唯一 source of truth。
2. 统一迁移入口。
3. 至少为关键迁移建立真实回滚策略或恢复手册。

**验收标准**

- 新环境初始化路径唯一且可复现。
- 文档中明确说明如何迁移、如何回滚。

### 4.7 P2：旧版 Compare 任务管线遗留

**问题描述**

这里指的是旧版 `/api/v1/tasks/compare/*` 任务管线，不是当前系统正在使用的 `/api/comparisons/*` 报告对比功能。

当前主线 Compare 仍保留：

- `/api/comparisons/*`
- `/history`
- `/comparison/:id`
- `comparison_results`
- `LlmJobRunner.processCompareJob`

旧版管线原本用于“上传两个 PDF 或输入两个 URL 后临时创建对比任务”，但它依赖已经退役的解析和结构化链路。

**影响**

- 如果被误当成可用功能，会产生空结果或误导。

**本轮处理状态**

当前分支已采用物理清理方案：

1. 删除旧任务服务、旧任务模型、旧队列处理器和旧前端页面。
2. `src/routes/retired-compare-tasks.ts` 仅对 `/api/v1/tasks/compare/*` 返回 `410 legacy_compare_tasks_retired`。
3. 响应中明确指向替代路径 `/api/comparisons`。
4. `src/__tests__/legacyCompareTasks.test.ts` 防止旧入口被误恢复。
5. 未改动当前主线 Compare 页面和 `/api/comparisons/*` 接口。

**整改要求**

两种方案二选一：

1. **短期方案**
   - 隐藏入口
   - 明确标记未完成
   - 移除对外可见能力

2. **长期方案**
   - 完成结构化、比对、摘要、导出闭环

**验收标准**

- 系统中不存在“用户可触发、但只能返回 stub 结果”的路径。
- 当前可用的报告对比主流程不受影响。

### 4.8 P2：调试暴露面

**问题描述**

当前前端存在两个明显调试入口：

1. `window.diagnoseDistrictData`
2. `?debug=true`

**影响**

- 生产包中暴露内部排查能力和内部标识信息。

**整改要求**

1. `window.diagnoseDistrictData` 改为仅开发环境挂载，或移除。
2. `?debug=true` 仅在开发环境启用。
3. 对页面内展示的 `reportId`、`versionId`、`storagePath` 做环境隔离。

**验收标准**

- 生产环境中无法通过 URL 参数打开技术排查面板。
- 浏览器全局对象中不再暴露诊断函数。

### 4.9 P2/P3：GovInsight 前端硬编码

**问题描述**

当前仍有多处硬编码：

- 雷达图年份 `2024`
- 默认城市 `淮安市`
- 默认年份 `2024`
- 任务模式 `demo`
- `city_nanjing` 父子关系特判

**影响**

- 多城市、多年份、真实环境切换容易出错。

**整改要求**

1. 年份从实际数据集中获取。
2. 默认城市和默认年份可配置或从首个可用数据推导。
3. `demo` 模式与真实 API 模式边界明确。
4. `city_nanjing` 替换为基于结构数据的父子关系推导。

**验收标准**

- 非 2024 年数据可正常展示。
- 非南京数据不再依赖硬编码分支。

### 4.10 P2：日志与调试输出

**问题描述**

服务端仍有调试输出和文档内容 preview。

**影响**

- 噪音日志
- 潜在敏感内容暴露

**整改要求**

1. 删除或降级调试日志。
2. 统一走 logger。
3. 文档内容 preview 仅允许在开发环境、且长度受限。

**验收标准**

- 生产路径无直接输出原始文档内容的日志。

### 4.11 P2：测试结构不完整

**问题描述**

当前测试并非没有，但结构偏斜：

- 有服务层单元测试
- 有部分前端组件测试
- 路由级 API 测试明显不足

**整改要求**

至少补齐以下接口的 supertest 级验证：

1. `auth`
2. `reports`
3. `data-center`
4. `users`

**验收标准**

- 核心接口有最小可用回归测试。

---

## 5. 交付给 MIMO 的整改任务包

以下任务可直接拆给 MIMO 执行。

### 任务 1：修复表三 `null -> 0`

- **目标：** 修复表三展示错误，区分 `null` 与 `0`
- **涉及文件：**
  - `frontend/src/components/TableViews.js`
  - 对应测试文件
- **验收：**
  - `null` 显示为 `"-"` 或约定空态
  - `0` 显示为 `"0"`
  - 不影响 `"/"`、`"不适用"` 展示

### 任务 2：收紧测试环境鉴权旁路

- **目标：** 防止仅凭 `NODE_ENV=test` 绕过鉴权
- **涉及文件：**
  - `src/middleware/auth.ts`
- **验收：**
  - 仅 `NODE_ENV=test` 不再绕过
  - 必须额外显式开启测试旁路

### 任务 3：移除 `id=1` 权限硬编码

- **目标：** 改为权限字段或角色驱动
- **涉及文件：**
  - `src/middleware/auth.ts`
- **验收：**
  - 不再使用 `id===1` 判定超管

### 任务 4：改造 `dataScope.ts` 为参数化查询

- **目标：** 消除动态 SQL 拼接
- **涉及文件：**
  - `src/utils/dataScope.ts`
- **验收：**
  - 不再手工拼接 `IN (...)`

### 任务 5：改造默认密码迁移端点

- **目标：** 移除 `admin123` 硬编码迁移逻辑
- **涉及文件：**
  - `src/routes/auth.ts`
  - `src/middleware/auth.ts`
- **验收：**
  - 代码中不再出现 `admin123`
  - 迁移路径仍可控、可审计

### 任务 6：统一迁移机制

- **目标：** 明确并统一 schema source of truth
- **涉及文件：**
  - `src/db/migrations.ts`
  - `src/db/migrations-llm.ts`
  - `migrations/`
  - `migrations/postgres/`
- **验收：**
  - 新环境初始化路径统一走 `runMigrations()`
  - 伪回滚不再删除迁移记录
  - 后续若需要真实回滚，单独补 down migration 或恢复手册

### 任务 7：处理旧版 Compare 任务管线

- **目标：** 显式下线旧 `/api/v1/tasks/compare/*`，保留当前 `/api/comparisons/*` 主线 Compare
- **涉及文件：**
  - `src/routes/retired-compare-tasks.ts`
  - 已删除的旧任务服务、旧模型、旧队列处理器和旧前端页面
  - 相关路由与前端入口
- **验收：**
  - 旧任务入口返回 `410 legacy_compare_tasks_retired`
  - 当前报告对比结果页、历史页和打印页不受影响

### 任务 8：移除生产调试暴露面

- **目标：** 限制 `window.diagnoseDistrictData` 和 `?debug=true`
- **涉及文件：**
  - `frontend/src/govinsight/utils/diagnose.ts`
  - `frontend/src/components/ReportDetail.js`
- **验收：**
  - 生产环境无全局诊断函数
  - 生产环境 URL 参数无法开启排查面板

### 任务 9：清理 GovInsight 硬编码

- **目标：** 去除年份、城市、父子关系等硬编码
- **涉及文件：**
  - `frontend/src/govinsight/components/ReportCharts.tsx`
  - `frontend/src/govinsight/leader-cockpit/config.ts`
  - `frontend/src/govinsight/services/apiService.ts`
- **验收：**
  - 非 2024 年、非南京数据正常工作

### 任务 10：补核心 API 测试

- **目标：** 增加路由级回归测试
- **涉及文件：**
  - `src/__tests__/`
  - `package.json`
- **验收：**
  - 核心接口具备最小 supertest 覆盖

---

## 6. 建议执行顺序

建议 MIMO 按以下顺序实施：

1. 任务 1：表三 `null -> 0`
2. 任务 2：测试环境鉴权旁路
3. 任务 3：`id=1` 权限硬编码
4. 任务 4：`dataScope.ts` 参数化
5. 任务 8：移除生产调试暴露面
6. 任务 5：默认密码迁移端点
7. 任务 9：GovInsight 硬编码
8. 任务 7：旧版 Compare 任务管线下线
9. 任务 6：统一迁移机制
10. 任务 10：补 API 测试

---

## 7. 最终结论

当前系统的真实问题是**可整改的、有边界的**，并非原稿中那种“多处 P0 同时爆炸”的状态。

如果要给整改执行方一个明确目标，本版建议只抓住两点：

1. **先修用户可见且结论会误导的页面问题**
2. **再收紧安全边界和迁移边界**

其中，最应该立即推进的是：

- 表三前端 `null -> 0`
- 测试环境鉴权旁路
- `id=1` 权限硬编码
- `dataScope.ts` 参数化

这四项修完后，再进入调试暴露面、硬编码、旧版 Compare 任务管线下线和迁移统一。
