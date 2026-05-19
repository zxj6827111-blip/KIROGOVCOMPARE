# 年报比对系统审计报告校正版

**校正日期：** 2026-05-17  
**对应原报告：** [SYSTEM_AUDIT_REPORT.md](</E:/Software Development/KIROGOVCOMPARE/SYSTEM_AUDIT_REPORT.md>)  
**校正方式：** 基于当前仓库代码的静态复核，不包含数据库实库比对、线上运行态抓包、生产构建产物反编译。  
**目的：** 将原报告中的“已确认问题”“结论过重的问题”“已过时的问题”“仍需补证据的问题”拆分，避免后续整改优先级被误导。

---

## 1. 总体结论

原审计报告**有参考价值，但不能原样作为最终结论**。  
复核后可分为四类：

1. **已确认，且建议继续整改的问题**
2. **问题方向成立，但原报告定性过重或严重级别偏高**
3. **原报告已过时，当前代码已部分修复或已不成立**
4. **需要数据库或运行态补证据后才能定性的项目**

从当前代码看，系统最值得优先处理的问题不是“所有 P0 都成立”，而是以下五类：

1. 鉴权旁路与超管旁路逻辑仍然存在。
2. 表三前端展示把 `null` 压成 `0`，会直接误导业务判断。
3. 迁移机制存在双轨和漂移风险，且无真正回滚。
4. 比对任务链路中仍有明显 stub/半成品模块。
5. GovInsight 前端存在若干硬编码默认值和调试暴露面。

---

## 2. 已确认问题

### 2.1 鉴权测试旁路与超管旁路

以下问题已由代码直接确认：

- `NODE_ENV === 'test'` 时，`authMiddleware` 会直接注入一个全权限测试用户。
- `requirePermission()` 中，`req.user.id === 1` 可绕过具体权限检查。
- token 签名比较使用普通字符串比较，而不是 timing-safe 比较。

这些问题对应的代码位置：

- [src/middleware/auth.ts](</E:/Software Development/KIROGOVCOMPARE/src/middleware/auth.ts>)

结论：

- 原报告关于“`NODE_ENV=test` 可绕过鉴权”和“id=1 超管绕过权限”的判断是准确的。
- 这两项应保留在高优先级整改清单中。
- “JWT 未使用 timing-safe 比较”也成立，但它的真实风险需要结合部署方式评估，不建议单独升到最高优先级。

### 2.2 表三前端 `null -> 0` 展示错误

表三读值逻辑多处使用 `|| 0`：

- `category[path] || 0`
- `category?.results?.denied?.[key] || 0`
- `category?.results?.unableToProvide?.[key] || 0`
- `category?.results?.notProcessed?.[key] || 0`
- `category?.results?.other?.[key] || 0`

代码位置：

- [frontend/src/components/TableViews.js](</E:/Software Development/KIROGOVCOMPARE/frontend/src/components/TableViews.js>)

结论：

- 原报告对这一条的判断是准确的。
- 这是一个真实的业务展示缺陷，不只是代码风格问题。
- 它会把“缺失/未解析/未提供”与“明确为 0”混淆，应该优先修。

### 2.3 数据迁移机制双轨且无真实回滚

当前仓库里可直接确认：

- [src/db/migrations.ts](</E:/Software Development/KIROGOVCOMPARE/src/db/migrations.ts>) 只读取 `migrations/` 根目录下的 `.sql`。
- `migrations/postgres/` 下的 SQL 文件不会由这个执行器自动跑。
- `rollbackMigration()` 只删除迁移记录，没有对应 down script。

结论：

- 原报告关于“迁移机制不统一”和“无真实回滚”的判断成立。
- 这类问题更准确的风险表述是：**环境初始化和后续演进容易漂移**，而不是立刻等同于线上数据已损坏。

### 2.4 Compare 流水线存在明显半成品

以下模块的结论基本成立：

- [src/services/CompareTaskProcessor.ts](</E:/Software Development/KIROGOVCOMPARE/src/services/CompareTaskProcessor.ts>)
- [src/services/ParsedDataStorageService.ts](</E:/Software Development/KIROGOVCOMPARE/src/services/ParsedDataStorageService.ts>)
- [src/services/StructuringService.ts](</E:/Software Development/KIROGOVCOMPARE/src/services/StructuringService.ts>)

当前可确认状态：

- `CompareTaskProcessor` 中结构化、比对、摘要、DOCX 导出等关键阶段仍有 `TODO`。
- `ParsedDataStorageService` 直接返回 `null`。
- `StructuringService` 返回 stub document。

结论：

- 原报告关于“CompareTaskProcessor 流水线为空壳”和相关 stub 服务的判断基本准确。
- 这类模块如果已暴露给真实用户，应被标记为未完成功能，而不是默默保留成“看似可用”。

### 2.5 GovInsight 前端存在真实硬编码

以下问题已确认：

- 雷达图硬编码 `const year = 2024`  
  位置：[frontend/src/govinsight/components/ReportCharts.tsx](</E:/Software Development/KIROGOVCOMPARE/frontend/src/govinsight/components/ReportCharts.tsx>)
- LeaderCockpit 默认城市 `淮安市`、默认年份 `2024`、任务模式 `demo`  
  位置：[frontend/src/govinsight/leader-cockpit/config.ts](</E:/Software Development/KIROGOVCOMPARE/frontend/src/govinsight/leader-cockpit/config.ts>)
- `city_nanjing` 父子关系特殊分支  
  位置：[frontend/src/govinsight/services/apiService.ts](</E:/Software Development/KIROGOVCOMPARE/frontend/src/govinsight/services/apiService.ts>)

结论：

- 原报告对这类硬编码问题的识别基本准确。
- 这批问题更偏“可移植性/多城市部署风险”，不一定都应该升为 P1，但确实需要整理。

### 2.6 调试入口与调试输出暴露面

以下现象当前代码可见：

- `window.diagnoseDistrictData` 被挂到 `window`
  - [frontend/src/govinsight/utils/diagnose.ts](</E:/Software Development/KIROGOVCOMPARE/frontend/src/govinsight/utils/diagnose.ts>)
- `ReportDetail` 用 `?debug=true` 打开技术排查模式
  - [frontend/src/components/ReportDetail.js](</E:/Software Development/KIROGOVCOMPARE/frontend/src/components/ReportDetail.js>)
- 服务端仍有若干 `console.log` / preview 输出
  - [src/services/ReportUploadService.ts](</E:/Software Development/KIROGOVCOMPARE/src/services/ReportUploadService.ts>)
  - [src/services/GeminiLlmProvider.ts](</E:/Software Development/KIROGOVCOMPARE/src/services/GeminiLlmProvider.ts>)

结论：

- 原报告关于“存在调试暴露面”的方向是对的。
- 但其中哪些真的会进入生产包、哪些只是开发阶段残留，还需要结合构建入口和部署方式判断。

---

## 3. 需降级或改写的结论

### 3.1 `admin123` 不是“可直接登录的硬编码默认密码”

原报告把这一条写成：

- `auth` 路由中硬编码默认密码 `admin123`
- 已知默认密码可被暴力破解

当前代码实际情况是：

- `admin123` 出现在 `POST /api/auth/reset-default-password` 逻辑中。
- 该接口还要求：
  - `ADMIN_BOOTSTRAP_TOKEN` 存在且长度足够；
  - 请求中 `bootstrapToken` 必须匹配；
  - 用户名必须是 `admin`；
  - 当前库里密码仍是旧 bcrypt 默认态。

代码位置：

- [src/routes/auth.ts](</E:/Software Development/KIROGOVCOMPARE/src/routes/auth.ts>)
- [src/middleware/auth.ts](</E:/Software Development/KIROGOVCOMPARE/src/middleware/auth.ts>)

校正结论：

- 这不是“正常登录路径里可直接使用的硬编码口令”。
- 更准确的表述应为：**系统保留了一个带 bootstrap token 的默认密码迁移接口，安全设计偏脆弱，需评估是否继续保留。**

### 3.2 `dataScope.ts` 存在拼接 SQL，但“任意 SQL 注入”表述过重

当前代码确实把 region name 拼进 SQL：

- [src/utils/dataScope.ts](</E:/Software Development/KIROGOVCOMPARE/src/utils/dataScope.ts>)

但当前实现同时做了单引号转义：

- `n.replace(/'/g, "''")`

校正结论：

- 应保留“**动态 SQL 拼接，不应继续保留**”这一问题。
- 但原报告写成“攻击者可注入任意 SQL”证据不足。
- 更准确的定性应是：**存在不安全拼接和可维护性问题，应改为参数化/数组绑定写法。**

### 3.3 “测试覆盖严重不足”不能直接写成“零覆盖”

当前仓库实际已有多组测试文件，例如：

- [src/__tests__](</E:/Software Development/KIROGOVCOMPARE/src/__tests__>)
- [frontend/src/components/TableViews.test.js](</E:/Software Development/KIROGOVCOMPARE/frontend/src/components/TableViews.test.js>)
- [frontend/src/components/ReportDetail.test.js](</E:/Software Development/KIROGOVCOMPARE/frontend/src/components/ReportDetail.test.js>)

校正结论：

- 原报告如果要保留这一条，应该改写为：
  - 路由级接口测试覆盖不足；
  - 端到端和运行态验证不足；
  - 报告生成全链路自动化验证不足；
  - 某些 `package.json` 测试脚本缺少同名测试集支撑。
- 不应笼统写成“系统整体零覆盖”。

### 3.4 API 文档过时这一条方向可留，但“60+ 活跃接口未文档化”未复核

当前仓库确实存在接口文件较多、`API.md` 明显较旧的问题，但本次未逐个统计“活跃接口数”和“文档覆盖率”。

校正结论：

- 可以保留“文档滞后”。
- 不建议保留“60+ 活跃接口未文档化”这种精确数字表述，除非重新统计。

---

## 4. 已过时或不应按原文保留的结论

### 4.1 OCR 修正后 facts 不会自动同步，这一条已过时

原报告写法是：

- `OcrCorrectionService` 修改 `parsed_json` 后需重新 materialize，否则 facts 会 stale

当前代码实际情况：

- 在确认 correction 后，`OcrCorrectionService` 会自动调用 `materializeService.materializeVersion(versionId)`；
- 随后还会继续执行 consistency check 和 vision review 入队。

代码位置：

- [src/services/OcrCorrectionService.ts](</E:/Software Development/KIROGOVCOMPARE/src/services/OcrCorrectionService.ts>)

校正结论：

- 这条作为“当前缺陷”已经不成立。
- 可以保留成“系统曾经存在这类风险，当前实现已补自动 re-materialize”。

### 4.2 `llm-jobs.ts` 未鉴权端点更像未挂载死代码，不应直接当线上漏洞

当前仓库中：

- [src/routes/llm-jobs.ts](</E:/Software Development/KIROGOVCOMPARE/src/routes/llm-jobs.ts>) 确有一个无鉴权 `GET /:id`
- 但主应用实际挂载的是 [src/routes/jobs.ts](</E:/Software Development/KIROGOVCOMPARE/src/routes/jobs.ts>)
- 挂载入口见 [src/app-llm.ts](</E:/Software Development/KIROGOVCOMPARE/src/app-llm.ts>)

校正结论：

- 这一条更适合归为“未接入死代码/潜在误导代码”。
- 不应直接表述成“当前线上可访问未鉴权端点”，除非运行态再次确认。

---

## 5. 仍需补证据的项目

以下项目本次不建议直接下最终结论，需要数据库或运行态证据：

### 5.1 迁移文件之间的精确 schema 差异

原报告列了多项字段类型、默认值、列名差异。  
方向上高度可信，但若要形成最终整改清单，建议补一次：

- `migrations-llm.ts`
- `migrations/`
- `migrations/postgres/full_schema.sql`
- 当前真实数据库 schema

之间的逐表 diff。

### 5.2 哪些调试能力实际暴露到生产

例如：

- `window.diagnoseDistrictData`
- `?debug=true`
- 服务端日志 preview

这些是否真的进入生产，需要结合：

- 前端构建入口
- 环境变量
- 线上部署方式
- 实际构建产物

做运行态确认。

### 5.3 未挂载路由/遗留模块是否影响真实功能

例如：

- [src/routes/notifications.ts](</E:/Software Development/KIROGOVCOMPARE/src/routes/notifications.ts>) 当前未在主应用挂载
- 若产品确实承诺有通知中心，则这是功能缺口
- 若该功能本就未启用，则更接近遗留代码问题

---

## 6. 建议的整改优先级

### 第一优先级

- 移除或收紧 `NODE_ENV=test` 鉴权旁路。
- 移除 `id=1` 超管硬编码绕过。
- 修复表三 `null -> 0` 显示错误。
- 把 `dataScope` 的动态 SQL 改为参数化写法。

### 第二优先级

- 统一迁移机制，明确哪套 schema 才是 source of truth。
- 给 Compare 相关 stub 功能加“不可用”边界，避免误用。
- 清理生产路径中的调试输出与调试入口。

### 第三优先级

- 清理 GovInsight 多城市部署硬编码。
- 统一 API 客户端与接口返回风格。
- 补接口文档和关键链路测试说明。

---

## 7. 校正版结论摘要

如果要用一句话总结当前仓库状态：

**这不是一份“原报告完全不准”的情况，而是一份“抓到了不少真问题，但把若干问题写重了、写旧了、写成了运行态已成立”的报告。**

因此后续最合理的做法不是直接按原 P0/P1 清单执行，而是：

1. 以本校正版作为新的评审基线；
2. 先修已确认且用户可感知/安全边界明确的问题；
3. 再对迁移差异、生产暴露面、死代码影响范围做第二轮证据化核查。

