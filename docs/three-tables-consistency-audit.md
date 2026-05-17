# 三表勾稽异常展示优化 — 补充检查报告

> 任务范围修正：表二、表三、表四三张核心表格的勾稽异常展示优化
> 检查日期：2026-05-14
> 检查范围：仅阅读代码，未做任何修改

---

## 1. 表二：主动公开政府信息情况

### 1.1 组件位置

- 渲染组件：`frontend/src/components/TableViews.js:28-126` → `Table2View`
- 数据路径：`section.activeDisclosureData`（`section.type === 'table_2'`）

### 1.2 数据结构

```javascript
activeDisclosureData: {
  regulations: { made, repealed, valid },           // 规章
  normativeDocuments: { made, repealed, valid },    // 行政规范性文件
  licensing: { processed },                         // 行政许可
  punishment: { processed },                        // 行政处罚
  coercion: { processed },                          // 行政强制
  fees: { amount }                                  // 行政事业性收费（万元）
}
```

### 1.3 现有校验规则

**后端 `ConsistencyCheckService`**：**无实质规则**。

- `generateTable3Items` 和 `generateTable4Items` 有完整逻辑，但表二没有对应的 `generateTable2Items` 方法
- 行1226-1241：仅有占位项 `t2_no_rules`，autoStatus 为 `NOT_ASSESSABLE`
- `generateTextItems` 中有部分正文一致性校验涉及表二数据（如"本年新收"与正文匹配），但这些归在 `text` 分组下，不归 `table2`

**前端实时诊断**：**无**。

- `analyzeTable3Diagnostics` 仅针对表三
- 表二没有对应的 `analyzeTable2Diagnostics` 函数

### 1.4 可推导的校验规则（当前未实现）

| 规则 | 公式 | 参与格数 |
|------|------|----------|
| 规章年度平衡 | 上年有效 + 本年制发 - 本年废止 ≈ 现行有效 | 3格（上年有效不在表中，需从正文或上年报告获取） |
| 规范性文件年度平衡 | 同上 | 3格 |
| 规章制发与废止合理性 | made ≥ 0, repealed ≥ 0, valid ≥ 0 | 数据质量校验 |

> **注意**：表二结构相对简单，大部分单元格是独立数值（licensing.processed、punishment.processed 等），没有行内恒等式。规章/规范性文件的"上年有效 + 本年制发 - 本年废止 = 现行有效"是唯一可能的行内规则，但需要上年数据。

### 1.5 异常展示方式

- **诊断横幅**：无（Table2View 没有 `analyzeDiagnostics` 逻辑）
- **单元格高亮**：支持（通过 `highlightCells` prop + `getHighlightMeta`），但当前没有后端 checks 产生相关路径
- **列头标记**：无（没有 `columnHeaderProps` 机制）
- **`data-cell-path`**：✅ 已有，格式为 `activeDisclosureData.{path}`（如 `activeDisclosureData.regulations.made`）

### 1.6 路径覆盖情况

**前端 `tableRowColMapping.js`** 中 `TABLE2_ROW_COL_MAP` 使用旧字段名（`previousYear`/`currentYearMade`/`currentYearRepealed`/`currentYearValid`），与实际数据字段（`made`/`repealed`/`valid`）**不一致**。

**`TABLE2_ROW_LABELS`** 和 **`TABLE2_COL_LABELS`** 已覆盖全部6行5列，可用于路径→位置映射。

### 1.7 结论

表二当前**只能提示"暂无校验规则"**，不能定位任何单元格。需要新增后端校验规则或前端实时诊断。

---

## 2. 表三：收到和处理政府信息公开申请情况

（保留上次检查结论，补充确认）

### 2.1 组件位置

- 渲染组件：`frontend/src/components/TableViews.js:177-482` → `Table3View`
- 前端诊断引擎：`frontend/src/utils/table3Diagnostics.js`
- 数据路径：`section.tableData`（`section.type === 'table_3'`）

### 2.2 现有校验规则

**后端 `ConsistencyCheckService.generateTable3Items()`**（行245-503）：

| 检查类型 | 公式 | 每实体格数 | 实体数 | 总检查项 |
|----------|------|------------|--------|----------|
| 办理结果分项求和 | granted + partialGrant + sum(denied.*) + sum(unableToProvide.*) + sum(notProcessed.*) + sum(other.*) = totalProcessed | 21格左 + 1格右 | 7 | 7 |
| **恒等式** | **newReceived + carriedOver = totalProcessed + carriedForward** | **2格左 + 2格右** | **7** | **7** |
| 各列求和=总计 | sum(6 entity field) = total field | 6格左 + 1格右 | 25字段 | 25 |

**前端 `analyzeTable3Diagnostics`**（table3Diagnostics.js）：

| 检查类型 | 说明 |
|----------|------|
| 拆格检测 | 同一行相邻两列单数字合并后可修复总计 |
| 恒等式检测 | newReceived + carriedOver = totalProcessed + carriedForward |

### 2.3 异常展示方式

- **诊断横幅**：✅ 有（Table3View 行264-286，显示"疑似拆格告警"和"表格数据勾稽异常"）
- **列头标记**：✅ 有（`columnHeaderProps` 为异常列的 `<th>` 添加 `table-diagnostic-column-header` 类）
- **单元格高亮**：部分有
  - `highlightCells`（后端 checks）→ 支持 `cell-focus-left`/`cell-focus-right`
  - 前端 `suspiciousByPath` → 仅记录拆格(split)，**不记录恒等式(identity)** ← 已知缺陷
- **`data-cell-path`**：✅ 已有，格式为 `tableData.{entity}.{fieldPath}`

### 2.4 四格路径稳定性

后端 `ConsistencyCheckService` 生成的恒等式检查项：

```javascript
leftPaths: [
  `tableData.${entityKey}.newReceived`,      // 本年新收
  `tableData.${entityKey}.carriedOver`,      // 上年结转
]
rightPaths: [
  `tableData.${entityKey}.results.totalProcessed`,   // 办理结果合计
  `tableData.${entityKey}.results.carriedForward`,   // 结转下年度
]
```

前端 `renderCell` 生成的 `fullPath` 格式完全一致。**路径匹配无问题**。

### 2.5 当前未标出四格的原因

`table3Diagnostics.js` 行168-212：恒等式检测结果写入 `identityRows[]`，但**没有**将四格路径写入 `suspiciousByPath` Map。因此 `getTable3SuspiciousCell(diagnostics, fullPath)` 对这四格返回 `null`，`renderCell` 不会添加 `cell-suspicious-fragment--mismatch` 类。

### 2.6 结论

表三**已有最完整的校验规则和前端诊断**，但恒等式四格未被标记是已知缺陷。表三适合作为三表通用展示机制的试点。

---

## 3. 表四：政府信息公开行政复议、行政诉讼情况

### 3.1 组件位置

- 渲染组件：`frontend/src/components/TableViews.js:484-568` → `Table4View`
- 数据路径：`section.reviewLitigationData`（`section.type === 'table_4'`）

### 3.2 数据结构

```javascript
reviewLitigationData: {
  review: { maintain, correct, other, unfinished, total },          // 行政复议
  litigationDirect: { maintain, correct, other, unfinished, total }, // 未经复议直接起诉
  litigationPostReview: { maintain, correct, other, unfinished, total } // 复议后起诉
}
```

### 3.3 现有校验规则

**后端 `ConsistencyCheckService.generateTable4Items()`**（行508-573）：

| 检查类型 | 公式 | 每类格数 | 类别数 | 总检查项 |
|----------|------|----------|--------|----------|
| 行内求和 | maintain + correct + other + unfinished = total | 4格左 + 1格右 | 3 | 3 |

三个类别：行政复议、未经复议直接起诉、复议后起诉。

路径格式：

```javascript
leftPaths: [
  `reviewLitigationData.${key}.maintain`,
  `reviewLitigationData.${key}.correct`,
  `reviewLitigationData.${key}.other`,
  `reviewLitigationData.${key}.unfinished`,
]
rightPaths: [
  `reviewLitigationData.${key}.total`,
]
```

**前端实时诊断**：**无**。

- 没有对应的 `analyzeTable4Diagnostics` 函数
- 仅依赖后端 checks

### 3.4 异常展示方式

- **诊断横幅**：无（Table4View 没有 `analyzeDiagnostics` 逻辑）
- **单元格高亮**：支持（通过 `highlightCells` prop + `getHighlightMeta`），后端 checks 已返回 leftPaths/rightPaths
- **列头标记**：无（没有 `columnHeaderProps` 机制）
- **`data-cell-path`**：✅ 已有，格式为 `reviewLitigationData.{category}.{field}`

### 3.5 路径覆盖情况

**前端 `tableRowColMapping.js`**：

- `TABLE4_ROW_LABELS`：覆盖3个类别 ✅
- `TABLE4_COL_LABELS`：覆盖5个字段 ✅
- `TABLE4_ROW_COL_MAP`：覆盖全部15格 ✅

**后端路径与前端 `fullPath` 一致性**：

| 后端 leftPaths/rightPaths | 前端 renderCell fullPath | 匹配 |
|---------------------------|-------------------------|------|
| `reviewLitigationData.review.maintain` | `reviewLitigationData.review.maintain` | ✅ |
| `reviewLitigationData.litigationDirect.total` | `reviewLitigationData.litigationDirect.total` | ✅ |
| `reviewLitigationData.litigationPostReview.other` | `reviewLitigationData.litigationPostReview.other` | ✅ |

**完全一致，路径可直接用于高亮定位。**

### 3.6 结论

表四**已有后端校验规则（3项），paths 完整，但没有前端实时诊断和诊断横幅**。后端 checks 返回的 leftPaths/rightPaths 足以支撑单元格定位。

---

## 4. 三张表是否共用渲染机制

**是。** 三个组件都在 `frontend/src/components/TableViews.js` 中：

| 共用机制 | Table2View | Table3View | Table4View |
|----------|------------|------------|------------|
| `getHighlightMeta()` | ✅ | ✅ | ✅ |
| `highlightCells` prop | ✅ | ✅ | ✅ |
| `ocrCorrections` prop | ✅ | ✅ | ✅ |
| `data-cell-path` 属性 | ✅ | ✅ | ✅ |
| `renderCellContent()` | ✅ | ✅ | ✅ |
| `GovDataTable.css` 样式 | ✅ | ✅ | ✅ |
| `analyzeDiagnostics` 前端诊断 | ❌ | ✅ | ❌ |
| `columnHeaderProps` 列头标记 | ❌ | ✅ | ❌ |
| 诊断横幅 | ❌ | ✅ | ❌ |

**结论**：底层高亮机制完全共用，但表三额外有前端实时诊断层（横幅+列头+单元格 suspicious 标记），表二和表四没有。

---

## 5. 三张表是否共用后端 checks

**是。** `GET /reports/:id/checks` 返回 `groups[]`，按 `group_key` 分组：

| group_key | group_name | 覆盖表 | 规则数 | paths 格式 |
|-----------|------------|--------|--------|------------|
| `table2` | 表二：主动公开 | 表二 | 1（占位，NOT_ASSESSABLE） | `sections[type=table_2].*`（不可用） |
| `table3` | 表三：非本机关产生 | 表三 | 7+7+25=39 | `tableData.*` ✅ |
| `table4` | 表四：行政复议诉讼 | 表四 | 3 | `reviewLitigationData.*` ✅ |
| `text` | 正文一致性校验 | 正文vs表三/表四 | 6 | `sections[n].content` + 表格路径 |
| `visual` | 视觉与结构审计 | 全表 | 动态 | `sections[type=table_*].*` |
| `structure` | 结构完整性审计 | 全表 | 动态 | `sections` |
| `quality` | 数据质量审计 | 正文 | 动态 | `sections[n].content` |

**关键发现**：

- `table2` 分组只有占位项，**没有实质性校验规则**
- `table3` 和 `table4` 的 paths 格式与前端 `fullPath` **完全一致**
- `table2` 即使添加规则，path 格式 `sections[table_2].activeDisclosureData.*` 与前端 `activeDisclosureData.*` **不一致**，需要 `normalizeTablePath` 补丁

---

## 6. evidenceJson.paths / leftPaths / rightPaths 是否足以支撑三表通用问题定位

### 表三：✅ 完全支撑

- `leftPaths` / `rightPaths` 覆盖所有恒等式检查的4格
- 路径格式 `tableData.{entity}.{field}` 与前端 `fullPath` 完全匹配
- `fetchHighlights()` 能正确提取并分类（left/right）

### 表四：✅ 完全支撑

- `leftPaths`（4格）/ `rightPaths`（1格）覆盖行内求和检查
- 路径格式 `reviewLitigationData.{category}.{field}` 与前端 `fullPath` 完全匹配

### 表二：❌ 不支撑

- 当前无实质性校验规则（仅占位 `t2_no_rules`）
- 即使添加规则，后端 path 格式 `sections[table_2].activeDisclosureData.*` 与前端 `activeDisclosureData.*` 不一致
- `normalizeTablePath` 只处理 `sections[table_2].` 前缀，不处理 `sections[type=table_2].` 前缀

### 汇总

| 表 | 后端checks | leftPaths/rightPaths | 路径与前端一致 | 可直接用于定位 |
|----|-----------|---------------------|---------------|--------------|
| 表二 | ❌ 无实质规则 | ❌ | ⚠️ 格式不一致 | ❌ |
| 表三 | ✅ 39项 | ✅ | ✅ | ✅ |
| 表四 | ✅ 3项 | ✅ | ✅ | ✅ |

---

## 7. 当前哪些表只能提示问题但不能定位单元格

| 表 | 能力 | 缺陷 |
|----|------|------|
| **表二** | 不能提示也不能定位 | 无校验规则，无前端诊断 |
| **表三** | 能提示，部分能定位 | 恒等式四格未写入 suspiciousByPath，仅拆格能定位 |
| **表四** | 能提示，能定位（后端checks） | 无前端诊断横幅，无列头标记 |

---

## 8. 建议抽象的通用组件

### 8.1 `TableIssueSummary`（表格问题摘要）

位置：建议放在 `TableViews.js` 或新建 `frontend/src/components/TableIssueSummary.js`

功能：
- 接收 `props: { issues: [], tableId: 'table_2'|'table_3'|'table_4' }`
- 显示：本表发现 N 处异常
- 每处异常显示：编号（①②③）、类型、涉及行列、公式、差额
- 点击编号 → 触发 `onLocate(issue)` 回调，滚动到对应单元格

数据来源：
- 优先使用后端 checks（`/reports/:id/checks` 中对应 group_key 的 items）
- 表三可额外叠加前端 `identityRows` 作为补充

### 8.2 `issueMarkers`（单元格标注数据层）

建议在 `TableViews.js` 中新增通用函数 `buildIssueMarkers(issues, tableId)`：

```javascript
// 输出格式
{
  'activeDisclosureData.regulations.made': {
    issueId: '①',
    issueKey: 't2_regulations_balance',
    tableNo: 'table_2',
    role: 'primary',       // 'primary' = 不平衡值, 'related' = 参与值
    side: 'left',          // 'left' | 'right'
    severity: 'error',
    title: '规章年度平衡异常',
    formulaText: '上年有效+本年制发-本年废止=现行有效',
    suggestion: '请核对规章现行有效件数'
  }
}
```

### 8.3 `IssueDetailDrawer`（问题详情抽屉）

位置：建议新建 `frontend/src/components/IssueDetailDrawer.js`

功能：
- 右侧滑出抽屉
- 显示：问题编号、所属表格、标题、校验规则、公式、左值、右值、差额、参与单元格列表、核对建议
- 关闭后清除 focus 高亮

---

## 9. 建议修改文件清单

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `frontend/src/utils/table3Diagnostics.js` | **核心修复** | 恒等式四格写入 suspiciousByPath |
| `src/services/ConsistencyCheckService.ts` | **新增规则** | 添加 `generateTable2Items()` 方法 |
| `frontend/src/components/TableViews.js` | **增强** | Table2View/Table4View 添加诊断横幅；三表统一 issueMarkers 机制 |
| `frontend/src/utils/tableRowColMapping.js` | **修正** | TABLE2_ROW_COL_MAP 字段名与实际数据对齐 |
| `frontend/src/utils/table2Diagnostics.js` | **新建** | 表二前端实时诊断（可选） |
| `frontend/src/utils/table4Diagnostics.js` | **新建** | 表四前端实时诊断（可选） |
| `frontend/src/components/TableIssueSummary.js` | **新建** | 通用问题摘要组件 |
| `frontend/src/components/IssueDetailDrawer.js` | **新建** | 问题详情抽屉组件 |
| `frontend/src/components/GovDataTable.css` | **增强** | 新增 issue-marker 相关样式 |
| `frontend/src/components/ReportDetail.js` | **适配** | 传递 issues 数据到各表格组件 |
| `frontend/src/components/ConsistencyCheckView.js` | **适配** | 支持按 table 过滤、定位到表格 |

---

## 10. 第一阶段：最小实现路径（表三试点 + 通用基础）

### 目标
表三恒等式四格能正确标注，建立通用标注数据结构。

### 步骤

**Step 1**：修复 `table3Diagnostics.js`（约6行）

在 `identityRows.push(...)` 之后，将四格路径写入 `suspiciousByPath`：

```javascript
affectedPaths.forEach((path) => {
  suspiciousByPath.set(path, {
    rowLabel,
    title,
    marker: '勾稽',
    type: 'mismatch',
  });
});
```

**Step 2**：在 `Table3View` 的诊断横幅中增加四格数值展示（约10行）

在 `table-diagnostic-card-detail` 中显示：
```
一(60)+二(0)=60，三(61)+四(0)=61，差额-1
参与格：[本年新收 60] [上年结转 0] [办理结果合计 61] [结转下年度 0]
```

**Step 3**：验证 `cell-suspicious-fragment--mismatch` 样式在表三中正确显示

- 红色背景 + 2px 内边框 + 左上角三角标记
- 4格全部标出，不仅限于2格

### 预期效果
表三恒等式异常时，4个参与格子全部标红，诊断横幅显示公式和差额。

---

## 11. 第二阶段：增强路径（三表通用）

### 目标
表二、表四也能显示问题摘要和单元格标注。

### 步骤

**Step 4**：后端添加表二校验规则

在 `ConsistencyCheckService` 中新增 `generateTable2Items()`：

```typescript
// 规章：made + repealed 与 valid 的关系（需考虑上年数据）
// 规范性文件：同上
// 可先实现简单的非负校验和数据完整性校验
```

**Step 5**：统一 `issueMarkers` 数据结构

在 `TableViews.js` 中新增 `buildIssueMarkers(issues, tableId)` 函数，将后端 checks 的 items 转换为统一的标注数据。

**Step 6**：Table2View / Table4View 接入 `issueMarkers`

- 在 `renderCell` 中检查 `issueMarkers[fullPath]`
- 如有标注，添加对应样式类和编号角标
- Table4View 已有后端 checks（3项），可直接使用

**Step 7**：新建 `TableIssueSummary` 组件

- 在每张表格上方显示问题摘要
- 编号与表格内单元格编号一致
- 点击编号触发定位

**Step 8**：新建 `IssueDetailDrawer` 组件

- 右侧抽屉显示问题详情
- 包含校验规则、公式、左右值、差额、核对建议

**Step 9**：`ReportDetail.js` 适配

- 将后端 checks 按 group_key 拆分，分别传入三个表格组件
- 管理 IssueDetailDrawer 的开关状态

**Step 10**：CSS 增强

- 统一 `cell-issue-primary`（实线框）和 `cell-issue-related`（虚线框）样式
- 编号角标样式

### 预期效果

三张表格都能：
1. 上方显示"本表发现 N 处异常"摘要
2. 异常单元格全部标出（不平衡值实线框、参与值虚线框）
3. 每个异常有编号，点击可查看详情
4. 不平衡的总计列/行才标红，平衡的不标

---

## 12. 风险点和需要确认的问题

| # | 风险/问题 | 说明 | 建议 |
|---|-----------|------|------|
| 1 | **表二缺少上年数据** | 规章/规范性文件的"上年有效+本年制发-本年废止=现行有效"规则需要"上年有效"数据。表二当前数据结构中没有 `previousYear` 字段（仅有 `made`/`repealed`/`valid`）。 | 暂不实现此规则，或从上年报告中获取。 |
| 2 | **表二 path 格式不一致** | 后端生成 `sections[table_2].activeDisclosureData.*`，前端期望 `activeDisclosureData.*`。`normalizeTablePath` 只处理 `sections[table_2].` 前缀。 | 修改 `normalizeTablePath` 支持 `sections[type=table_2].` 格式，或统一后端 path 格式。 |
| 3 | **表二字段名映射过时** | `TABLE2_ROW_COL_MAP` 使用 `previousYear`/`currentYearMade` 等旧字段名，实际数据用 `made`/`repealed`/`valid`。 | 更新映射表字段名。 |
| 4 | **表四无前端诊断** | 表四仅依赖后端 checks，如果用户未运行校验，表格内无任何异常标记。 | 第二阶段可添加 `analyzeTable4Diagnostics`，或强制首次加载时自动运行校验。 |
| 5 | **双轨高亮叠加** | 表三同时有前端 `suspiciousByPath` 和后端 `highlightCells` 两套高亮。修复后可能在同一个 `<td>` 上同时有 `cell-suspicious-fragment--mismatch` 和 `cell-focus-left`。 | CSS 层面确保优先级不冲突，或合并为一套。 |
| 6 | **总计列误标** | 如果总计列本身平衡（如洋河新区案例），不应标红。但如果总计列不平衡（各列之和≠总计），应标红。 | `issueMarkers` 中需区分"恒等式异常"（列内纵向）和"求和异常"（横向合计），总计列只在求和异常时标红。 |
| 7 | **表三 column headers 是否需要为表二/表四复制** | 表三的 `columnHeaderProps` 机制为异常列的 `<th>` 添加红色下划线。表二和表四没有此机制。 | 第二阶段可为 Table4View 添加类似机制（3个类别列如有异常，列头标红）。表二结构不同（按条款分组），列头标记需单独设计。 |
| 8 | **性能** | 每次渲染 Table3View 都调用 `analyzeTable3Diagnostics`。如果三表都加前端诊断，需注意性能。 | 前端诊断计算量很小（遍历几十个单元格），无性能风险。 |
| 9 | **`ConsistencyCheckView` 面板定位** | 当前"定位到表格"按钮仅在 `onLocate` 回调存在时显示。需要确认表四的 checks 是否也能触发定位。 | 确认 `ReportDetail.js` 中 `onLocate` 是否覆盖所有 group_key。 |
| 10 | **是否需要"一键核对"交互** | 用户可能想一次性看到所有异常表格的汇总，而不是逐表查看。 | 考虑在报告详情页顶部增加全局异常汇总栏。 |

---

## 附录：三表校验能力对比总览

| 能力 | 表二 | 表三 | 表四 |
|------|------|------|------|
| 后端校验规则 | ❌ 无（仅占位） | ✅ 39项 | ✅ 3项 |
| 后端 paths 格式 | ⚠️ 不可用 | ✅ 一致 | ✅ 一致 |
| 前端实时诊断 | ❌ 无 | ✅ 拆格+恒等式 | ❌ 无 |
| 诊断横幅 | ❌ | ✅ | ❌ |
| 列头异常标记 | ❌ | ✅ | ❌ |
| 单元格高亮（后端checks） | ❌ | ✅ | ✅ |
| 单元格高亮（前端诊断） | ❌ | ⚠️ 仅拆格 | ❌ |
| data-cell-path | ✅ | ✅ | ✅ |
| 行列映射 | ⚠️ 字段名过时 | ✅ 完整 | ✅ 完整 |
| 可立即实现四格标注 | ❌ | ✅（需修6行） | ✅（5格：4左+1右） |
| 需新增后端规则 | ✅ 需要 | ❌ 已有 | ❌ 已有 |
| 需新增前端诊断 | ⚠️ 可选 | ❌ 已有 | ⚠️ 可选 |

---

## 附录：表四可立即实现的标注

表四后端 checks 已返回完整 paths，**无需任何后端改动**，只需前端接入即可：

```
行政复议异常时标出5格：
  [结果维持] [结果纠正] [其他结果] [尚未审结] → [总计]

未经复议直接起诉异常时标出5格：
  [结果维持] [结果纠正] [其他结果] [尚未审结] → [总计]

复议后起诉异常时标出5格：
  [结果维持] [结果纠正] [其他结果] [尚未审结] → [总计]
```

前端 `renderCell` 已设置 `data-cell-path`，`getHighlightMeta` 已能匹配路径。只需确保 `fetchHighlights` 正确提取 `table4` 分组的 items 即可（当前已支持）。
