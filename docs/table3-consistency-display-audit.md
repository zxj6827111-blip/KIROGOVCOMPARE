# 表三勾稽异常展示优化 — 现有逻辑检查报告

> 任务：政府信息公开年报汇总页 / 表三勾稽异常展示优化
> 检查日期：2026-05-14
> 检查范围：仅阅读代码，未做任何修改

---

## 1. 页面与组件位置

| 组件 | 文件路径 | 作用 |
|------|----------|------|
| 年报汇总页 | `frontend/src/components/CityIndex.js` | 区域/报告列表，批量校验入口 |
| 报告详情页 | `frontend/src/components/ReportDetail.js` | 主容器，管理高亮状态、定位逻辑 |
| **表三渲染** | `frontend/src/components/TableViews.js:177-482` → `Table3View` | 表格渲染 + 诊断横幅 + 单元格高亮 |
| 勾稽校验面板 | `frontend/src/components/ConsistencyCheckView.js` | 校验结果列表，含"定位到表格"按钮 |
| 前端诊断引擎 | `frontend/src/utils/table3Diagnostics.js` | 前端实时计算 拆格 + 恒等式异常 |
| 行列映射表 | `frontend/src/utils/tableRowColMapping.js` | 路径→行列号映射 |
| 后端校验服务 | `src/services/ConsistencyCheckService.ts` | 持久化勾稽校验（DB 存储） |
| 校验 API 路由 | `src/routes/consistency.ts` | GET/POST/PATCH 校验接口 |

---

## 2. 数据来源与接口

- **表三数据**：`GET /reports/:id` → `parsed_json.sections[].type === 'table_3'` → `section.tableData`
- **勾稽校验结果**：`GET /reports/:id/checks` → `data.groups[].items[]`（从 `report_consistency_items` 表读取，`evidence_json` 字段已 parse 为对象）
- **前端实时诊断**：`Table3View` 每次渲染时调用 `analyzeTable3Diagnostics(data)` 实时计算

**双轨并行**：后端 `ConsistencyCheckService`（持久化）和前端 `table3Diagnostics.js`（实时）都在做恒等式校验，但两者独立运行，互不依赖。

---

## 3. 现有勾稽规则

### 后端 `ConsistencyCheckService.generateTable3Items()` (行245-503)

对7个实体（naturalPerson, legalPerson.commercial, ..., total）各生成两类检查：

**检查1 — 办理结果分项求和**：

```
granted + partialGrant + sum(denied.*) + sum(unableToProvide.*) + sum(notProcessed.*) + sum(other.*) = totalProcessed
```

**检查2 — 恒等式**（即本次优化目标）：

```
newReceived + carriedOver = totalProcessed + carriedForward
```

- `leftPaths`: `[basePath.newReceived, basePath.carriedOver]`
- `rightPaths`: `[basePath.results.totalProcessed, basePath.results.carriedForward]`

**检查3 — 各列求和=总计**（行401-500）：对每个字段检查6列之和是否等于总计列。

### 前端 `table3Diagnostics.js` (行168-212)

对每个实体检查同一恒等式：`newReceived + carriedOver === totalProcessed + carriedForward`，不等则推入 `identityRows`。

---

## 4. 现有异常数据结构

### 后端 `ConsistencyItem` (ConsistencyCheckService.ts:75-93)

```typescript
{
  groupKey: 'table3',          // 分组
  checkKey: 't3_identity_naturalPerson',  // 检查项唯一标识
  fingerprint: string,         // SHA256 去重指纹
  title: string,               // 展示标题
  expr: string,                // 公式表达式
  leftValue: number | null,    // 左值 (newReceived + carriedOver)
  rightValue: number | null,   // 右值 (totalProcessed + carriedForward)
  delta: number | null,        // 差值
  tolerance: 0,                // 容差
  autoStatus: 'PASS'|'FAIL'|'UNCERTAIN',
  evidenceJson: {
    paths: string[],           // 所有相关路径（兼容旧逻辑）
    leftPaths: string[],       // 左值来源路径（4格中的2格）
    rightPaths: string[],      // 右值来源路径（4格中的另2格）
    values: { newReceived, carriedOver, totalProcessed, carriedForward }
  }
}
```

### 前端 `identityRows[]` (table3Diagnostics.js:198-211)

```javascript
{
  key: 'naturalPerson_identity',
  entityFullPath: 'naturalPerson',   // 或 'legalPerson.commercial' 等
  rowLabel: '自然人列',
  incoming: 60,                      // newReceived + carriedOver
  outgoing: 61,                      // totalProcessed + carriedForward
  delta: -1,
  direction: '三+四比一+二多 1',
  breakdown: '...',                  // 非零办理明细
  formulaText: '一+二=60，三+四=61',
  message: '...',
  title: '...',
  paths: [                           // 4格完整路径
    'tableData.naturalPerson.newReceived',
    'tableData.naturalPerson.carriedOver',
    'tableData.naturalPerson.results.totalProcessed',
    'tableData.naturalPerson.results.carriedForward'
  ]
}
```

---

## 5. 现有高亮逻辑

存在 **两套独立的高亮机制**：

### 机制A：`highlightCells`（来自后端校验结果）

- `ReportDetail.js:1210-1298` → `fetchHighlights()` 从 `/checks` API 提取 `leftPaths` / `rightPaths`
- 每个 path 附带 `{ path, type: 'left'|'right' }` 标记
- 通过 `getHighlightMeta(fullPath, highlightCells)` 匹配，返回 CSS 类：
  - `cell-focus-left`（蓝色背景+左标签）
  - `cell-focus-right`（橙色背景+右标签）
  - `cell-focus-both`（紫色）
- **默认模式**下这些类会被应用到单元格的 `<td>` 上

### 机制B：`analyzeTable3Diagnostics`（前端实时计算）

- `Table3View` 每次渲染时调用 (行179)
- **诊断横幅**：在表格上方显示"表格数据勾稽异常"卡片（行264-286）
- **列头标记**：通过 `columnHeaderProps` 在 `<th>` 上添加 `table-diagnostic-column-header` 类（行220-227），显示红色下划线
- **单元格标记**：通过 `getTable3SuspiciousCell(diagnostics, fullPath)` 检查是否属于 `suspiciousByPath`（目前只存拆格 split 类型，**不存恒等式 identity 类型**）

---

## 6. 当前为什么没有标出四格

**根本原因**：`suspiciousByPath` Map 只记录了 **拆格(split)** 异常的单元格路径，**没有记录恒等式(identity)** 异常的四格路径。

具体分析 `table3Diagnostics.js`：

- 行152-165：拆格异常 → `suspiciousByPath.set(path, ...)` ✅ 已存储
- 行168-212：恒等式异常 → `identityRows.push(...)` 但 **没有** 对应的 `suspiciousByPath.set(...)` ❌ 未存储

因此在 `renderCell` 中（行229-259）：

```javascript
const suspicious = fullPath ? getTable3SuspiciousCell(diagnostics, fullPath) : null;
// ↑ 对于恒等式异常的四格，suspicious 永远是 null
// → 不会添加 'cell-suspicious-fragment' 类
// → 单元格无视觉标记
```

同时，**列头虽然有红色下划线**（`table-diagnostic-column-header`），但单元格本身没有对应样式。

至于 `highlightCells`（机制A），它在"定位到表格"按钮点击后才激活为 `focusedCells`，默认模式下虽然也会应用，但需要后端校验已运行且数据正确。

---

## 7. 是否具备实现四格标注的数据条件

**已完全具备**。

| 数据 | 状态 | 位置 |
|------|------|------|
| 四格路径 | ✅ 已有 | `identityRows[].paths` 数组（4个完整路径） |
| 实体标识 | ✅ 已有 | `identityRows[].entityFullPath`（如 'naturalPerson'） |
| 异常方向 | ✅ 已有 | `identityRows[].direction`（如 "三+四比一+二多 1"） |
| 公式文本 | ✅ 已有 | `identityRows[].formulaText`（如 "一+二=60，三+四=61"） |
| 单元格匹配函数 | ✅ 已有 | `getTable3SuspiciousCell(diagnostics, fullPath)` |
| CSS 高亮样式 | ✅ 已有 | `cell-suspicious-fragment--mismatch` 类（GovDataTable.css） |

---

## 8. 建议的最小修改点

### 修改1（核心）：`frontend/src/utils/table3Diagnostics.js`

在恒等式检测循环末尾（行196附近），将四格路径写入 `suspiciousByPath`：

```javascript
// 在 identityRows.push(...) 之后添加：
affectedPaths.forEach((path) => {
  suspiciousByPath.set(path, {
    rowLabel,
    title,
    marker: '勾稽',
    type: 'mismatch',
  });
});
```

**改动量**：约6行。这是最核心的一刀——补上缺失的映射。

### 修改2（无需改动）：`frontend/src/components/TableViews.js`

`columnHeaderProps` 中已有 `table-diagnostic-column-header` 类，CSS 中已有对应样式（红色下划线）。无需改动。

### 修改3（可选增强）：`frontend/src/components/TableViews.js`

在诊断横幅的恒等式异常卡片中（行275-284），增加四格数值的直观展示。

### 修改4（可选）：`frontend/src/components/GovDataTable.css`

如果 `cell-suspicious-fragment--mismatch` 的样式不够醒目，可以增强颜色或增加边框。

---

## 9. 风险点和需要确认的问题

| # | 风险/问题 | 说明 |
|---|-----------|------|
| 1 | **总计列是否应标红** | 当前 `analyzeTable3Diagnostics` 对总计列也检查恒等式。如果总计列本身平衡（如本次案例），不应标红。如果总计列不平衡，应标红。需确认是否需要特殊处理总计列。 |
| 2 | **路径一致性** | `identityRows[].paths` 使用 `tableData.naturalPerson.newReceived` 格式，`renderCell` 生成的 `fullPath` 也是同样格式。经核对一致，无风险。 |
| 3 | **双轨冲突** | 前端实时诊断和后端持久化校验同时运行。如果用户未运行过后端校验，`highlightCells` 为空，仅靠前端诊断。已运行后端校验时两套高亮可能叠加。需确认是否需要去重。 |
| 4 | **后端返回异常数** | 后端对每个实体生成独立的恒等式检查项。如果自然人列和其他列都异常，后端返回2个 FAIL 项，每项有自己的 leftPaths/rightPaths。前端 `fetchHighlights` 会合并所有路径。理论上应标出所有8格（4格×2列），但需验证。 |
| 5 | **已有高亮样式重叠** | `cell-suspicious-fragment--mismatch` 和 `cell-focus-left`/`cell-focus-right` 可能同时存在于一个 `<td>` 上。需检查 CSS 优先级是否冲突。 |
| 6 | **`tableRowColMapping.js` 字段名不一致** | 映射文件中使用 `previousYearCarryover`，但实际数据字段是 `carriedOver`。这是旧数据兼容问题，不影响本次修改，但建议同步清理。 |

---

## 10. 业务规则核对

表三每一列应满足：

```
本年新收 + 上年结转 = 办理结果合计 + 结转下年度继续办理
```

洋河新区 2025 年数据：

| 列 | 本年新收 | 上年结转 | 左值合计 | 办理结果合计 | 结转下年 | 右值合计 | 差额 | 状态 |
|----|----------|----------|----------|--------------|----------|----------|------|------|
| 自然人 | 60 | 0 | 60 | 61 | 0 | 61 | -1 | ❌ 异常 |
| 其他 | 1 | 0 | 1 | 0 | 0 | 0 | +1 | ❌ 异常 |
| 总计 | 62 | 0 | 62 | 62 | 0 | 62 | 0 | ✅ 平衡 |

两个异常差额互为相反数（-1 和 +1），疑似同1件申请在"自然人"和"其他"之间归类错位。

---

## 结论

最小改动集中在 `frontend/src/utils/table3Diagnostics.js` 一个文件约6行代码，将恒等式异常的四格路径写入 `suspiciousByPath` Map，即可让 `Table3View` 的 `renderCell` 自动为这些单元格添加 `cell-suspicious-fragment--mismatch` 样式类。其余修改为可选增强。
