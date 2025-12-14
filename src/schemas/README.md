# 年报表格 Schema 说明

## 概述

本目录包含政府信息公开年度报告的表格 Schema 定义，用于指导 PDF 解析和表格提取。

## Schema 版本

### v1.0 (annual_report_table_schema_v1.json)

**特点**: 灵活的表格定义，支持变长行列

**包含的表格**:
- `table_active_disclosure`: 主动公开政府信息情况（章节二）
- `table_foia_requests`: 收到和处理政府信息公开申请情况（章节三）
- `table_administrative_review`: 政府信息公开行政复议、行政诉讼情况（章节四）

**适用场景**: 初期原型开发、灵活的表格结构

### v2.0 (annual_report_table_schema_v2.json)

**特点**: 固定的行列结构，严格遵循政府信息公开年报规范

**包含的表格**:

#### 章节二 - 主动公开政府信息情况（4 个子表）

1. **table_chapter2_section1** - 第（一）项
   - 固定 1 行
   - 列: 主动公开条数

2. **table_chapter2_section5** - 第（五）项
   - 固定 1 行
   - 列: 信息类别、公开条数

3. **table_chapter2_section6** - 第（六）项
   - 固定 1 行
   - 列: 公开形式、公开条数

4. **table_chapter2_section8** - 第（八）项
   - 固定 1 行
   - 列: 公开渠道、访问次数

#### 章节三 - 收到和处理政府信息公开申请情况

**table_chapter3_foia_requests**
- 固定 25 行（按 rowLabels 定义）
- 固定 7 列: 自然人、法人或其他组织、媒体、教育科研机构、其他、总计

**行标签** (rowLabels):
```
1. 收到申请数
2. 其中：1.当面申请
3. 2.邮件申请
4. 3.电话申请
5. 4.网络申请
6. 5.其他方式
7. 对上年度分类未当场处理的申请的处理
8. 收到申请总数
9. 已全部公开
10. 已部分公开
11. 不予公开
12. 信息不存在
13. 申请内容不明确
14. 不是《条例》所指信息
15. 法律、法规禁止公开
16. 其他原因
17. 处理申请总数
18. 结转下年度继续处理
19. 平均处理时间（天）
20. 最长处理时间（天）
21. 行政复议申请数
22. 行政诉讼案件数
23. 举报投诉数
24. 其他
25. 总计
```

#### 章节四 - 政府信息公开行政复议、行政诉讼情况

**table_chapter4_administrative_review**
- 固定 1 行
- 固定 15 列: 
  - 复议相关 (5 列): 申请数、中止数、撤销数、维持数、其他数
  - 诉讼相关 (10 列): 案件数、中止数、撤诉数、驳回数、维持数、撤销数、其他数、总数、平均处理时间、最长处理时间

## 表格提取流程

### 步骤 1: 定位表格
- 按 `chapterNumber` 和 `titleKeywords` 定位表格在 PDF 中的位置
- 返回表格所在的页码

### 步骤 2: 坐标聚类
- 基于 PDF 文本块的 x/y 坐标进行聚类
- Y 坐标相近的文本块视为同一行
- X 坐标排序确定列顺序

### 步骤 3: 行匹配
- 对于固定行结构的表格，按 `rowLabels` 匹配行
- 提取每行的数据

### 步骤 4: 列聚类
- 按 X 坐标对列进行聚类
- 按 `columns` 定义的列数进行分组

### 步骤 5: 骨架填充
- 创建固定大小的表格骨架（行数 × 列数）
- 将提取的数据填入对应位置
- 未匹配到的单元格填空字符串

### 步骤 6: 警告处理
- 若提取的行数 < 预期行数，标记 `degraded=true`
- 写入 warning: `code=TABLE_SCHEMA_MISS`、`stage=parsing`
- 包含缺失的行列信息

## 数据结构

### StructuredDocument 中的 Table

```typescript
interface Table {
  id: string;                    // 表格 ID（来自 schema）
  title: string;                 // 表格标题
  rows: TableRow[];              // 行数据
  columns: number;               // 列数
  rowLabels?: string[];          // 行标签（来自 schema）
  colNames?: string[];           // 列名（来自 schema）
  degraded?: boolean;            // 是否降级（提取不完整）
  warnings?: Warning[];          // 警告列表
}

interface TableRow {
  id: string;                    // 行 ID
  rowIndex: number;              // 行索引
  rowLabel?: string;             // 行标签（来自 schema）
  cells: TableCell[];            // 单元格数据
}

interface TableCell {
  id: string;                    // 单元格 ID
  rowIndex: number;              // 行索引
  colIndex: number;              // 列索引
  colName?: string;              // 列名（来自 schema）
  content: string;               // 单元格内容
}
```

## 使用示例

### 在 PdfParseService 中使用 v2 Schema

```typescript
import schemaV2 from '../schemas/annual_report_table_schema_v2.json';

// 提取表格
const tables = await this.extractCanonicalTables(pages, schemaV2, warnings);

// 输出结构化文档
const document: StructuredDocument = {
  documentId: `doc_${assetId}`,
  assetId,
  title: this.extractTitle(pages),
  sections: this.buildSections(pages, tables),
  metadata: {
    totalPages: pageCount,
    extractedAt: new Date(),
    parseVersion: '2.0',
  },
};
```

### 在 DiffService 中使用表格信息

```typescript
// 比对表格时，使用 rowLabel 和 colName
const cellChange = {
  rowIndex: 0,
  colIndex: 1,
  rowLabel: '收到申请数',      // 来自 schema
  colName: '自然人',            // 来自 schema
  type: 'modified',
  before: '100',
  after: '150',
};
```

### 在 DocxExportService 中输出可读的表格差异

```typescript
// 输出格式: "行名 / 列名: 旧值 → 新值"
const readableChange = `${cellChange.rowLabel} / ${cellChange.colName}: ${cellChange.before} → ${cellChange.after}`;
```

## 扩展指南

### 添加新的表格

1. 在 schema 中添加新的 table 对象
2. 定义 `tableId`、`chapterNumber`、`titleKeywords`
3. 定义 `columns` 数组（列定义）
4. 如果是固定行结构，定义 `rowLabels` 数组
5. 在 PdfParseService 中添加对应的提取逻辑

### 修改现有表格

1. 更新 schema 中的 `columns` 或 `rowLabels`
2. 更新 `parseVersion` 版本号
3. 在 PdfParseService 中更新提取逻辑
4. 添加 migration 脚本处理历史数据

## 注意事项

1. **行列固定性**: v2 schema 要求严格的行列结构，未匹配到的单元格填空
2. **警告处理**: 表格提取不完整时必须写入 warning，便于后续审核
3. **版本管理**: 修改 schema 时必须更新 `parseVersion`，以便缓存失效
4. **向后兼容**: 新增列时应在末尾添加，避免破坏现有列的索引

## 参考资源

- [政府信息公开条例](http://www.gov.cn/)
- [年报表格规范](https://www.gov.cn/)
- [PDF 解析指南](../services/PdfParseService.ts)
- [差异比对指南](../services/DiffService.ts)

