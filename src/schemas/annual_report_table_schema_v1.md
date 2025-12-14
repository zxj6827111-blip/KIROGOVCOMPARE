# 政府信息公开年度报告 - 表格 Schema 说明

## 概述

本 Schema 定义了政府信息公开年度报告中三张核心表格的标准结构（Canonical Schema）。

采用"固定表格骨架 + 抽取填充"策略，而非泛化表格识别，以确保解析的稳定性和可比对性。

## 三张核心表

### 1. 主动公开政府信息情况表（table_active_disclosure）

**位置**：第二章

**标题关键字**：主动公开、政府信息情况

**列定义**：
- `category` (string): 信息类别（如：机构信息、法律法规、规划计划、业务动态、其他）
- `count` (number): 公开条数

**预期行数**：3-10 行

**示例**：
```json
{
  "tableId": "table_active_disclosure",
  "rows": [
    { "category": "机构信息", "count": 15 },
    { "category": "法律法规", "count": 28 },
    { "category": "规划计划", "count": 12 },
    { "category": "业务动态", "count": 156 },
    { "category": "其他", "count": 45 }
  ],
  "degraded": false
}
```

### 2. 收到和处理政府信息公开申请情况表（table_foia_requests）

**位置**：第三章

**标题关键字**：收到和处理、政府信息公开申请

**列定义**：
- `requestType` (string): 申请类型（如：当面申请、邮件申请、网络申请、其他方式）
- `requestCount` (number): 申请数量
- `processedCount` (number): 处理数量

**预期行数**：3-10 行

**示例**：
```json
{
  "tableId": "table_foia_requests",
  "rows": [
    { "requestType": "当面申请", "requestCount": 5, "processedCount": 5 },
    { "requestType": "邮件申请", "requestCount": 12, "processedCount": 12 },
    { "requestType": "网络申请", "requestCount": 28, "processedCount": 28 },
    { "requestType": "其他方式", "requestCount": 2, "processedCount": 2 }
  ],
  "degraded": false
}
```

### 3. 政府信息公开行政复议、行政诉讼情况表（table_administrative_review）

**位置**：第四章

**标题关键字**：行政复议、行政诉讼

**列定义**：
- `itemType` (string): 事项类型（如：行政复议申请、行政诉讼案件）
- `count` (number): 数量

**预期行数**：2-5 行

**示例**：
```json
{
  "tableId": "table_administrative_review",
  "rows": [
    { "itemType": "行政复议申请", "count": 0 },
    { "itemType": "行政诉讼案件", "count": 1 }
  ],
  "degraded": false
}
```

## 提取策略

### 步骤

1. **定位表格**：按章节号和标题关键字定位表格在 PDF 中的位置
2. **聚类提取**：基于 PDF 文本块坐标（x/y）聚类提取表内值
3. **行匹配**：按行文本规则匹配预期行
4. **填充骨架**：将提取的值填入固定表格骨架
5. **降级处理**：若提取失败，标记为 `degraded=true` 并写入 warnings

### 降级处理

- **完全失败**：表格无法定位或提取，标记 `degraded=true`，写入 warning（code: `TABLE_PARSE_FAILED`）
- **部分失败**：表格定位成功但某些行/列提取不完整，标记 `degraded=true`，写入 warning（code: `TABLE_ALIGN_PARTIAL`）
- **成功**：所有行列都成功提取，标记 `degraded=false`

### 文本标准化

- 去除多余空白（前后空格、多余换行）
- 统一全角/半角（可选，最小必要即可）
- 保留原始文本备查

## 输出格式

### Canonical Table JSON

```json
{
  "tableId": "table_active_disclosure",
  "chapterNumber": "二",
  "chapterTitle": "主动公开政府信息情况",
  "rows": [
    {
      "rowId": "row_1",
      "cells": [
        { "cellId": "cell_1_1", "colKey": "category", "value": "机构信息" },
        { "cellId": "cell_1_2", "colKey": "count", "value": "15" }
      ]
    }
  ],
  "degraded": false,
  "warnings": []
}
```

### 主键设计

- `tableId`: 表格唯一标识（如 `table_active_disclosure`）
- `rowId`: 行唯一标识（如 `row_1`）
- `cellId`: 单元格唯一标识（如 `cell_1_1`）
- `colKey`: 列键（如 `category`、`count`）

这些主键用于后续 diff 操作，确保可以精确定位变化。

## 使用示例

### 在解析服务中读取 Schema

```typescript
import schema from '../schemas/annual_report_table_schema_v1.json';

const tableSchema = schema.tables.find(t => t.tableId === 'table_active_disclosure');
// 使用 tableSchema 来指导表格提取
```

### 在 Diff 服务中使用 Canonical Table

```typescript
// 比对两份报告的表格
const table1 = parsedDoc1.canonicalTables.find(t => t.tableId === 'table_active_disclosure');
const table2 = parsedDoc2.canonicalTables.find(t => t.tableId === 'table_active_disclosure');

// 按 cellId 进行 cell-level diff
const cellDiffs = diffTables(table1, table2);
```

## 注意事项

1. **不追求视觉还原**：不需要还原 PDF 中的视觉表格样式，只需提取数据
2. **稳定性优先**：采用固定 Schema 确保解析稳定，而非追求完全泛化
3. **降级可解释**：任何降级都必须通过 warnings 给出原因和影响范围
4. **向后兼容**：Schema 更新时保持向后兼容，新增字段不影响现有解析
