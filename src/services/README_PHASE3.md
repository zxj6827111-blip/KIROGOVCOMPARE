# 第三阶段：PDF 解析与结构化

## 概述

第三阶段实现了 PDF 文档的解析和结构化，采用"固定表格骨架 + 抽取填充"策略，确保解析的稳定性和可比对性。

## 核心组件

### 1. PdfParseService

**职责**：解析 PDF 文件，提取文本、表格和元数据

**主要方法**：
- `parsePDF(filePath, assetId)`: 解析 PDF 文件
  - 输入：PDF 文件路径、资产 ID
  - 输出：ParseResult（包含 StructuredDocument 和 warnings）

**输出结构**：
```typescript
{
  success: boolean,
  document: {
    documentId: string,
    assetId: string,
    title: string,
    sections: Section[],
    metadata: {
      totalPages: number,
      extractedAt: Date,
      parseVersion: string
    }
  },
  warnings: Warning[]
}
```

**表格提取策略**：
1. 按章节号和标题关键字定位表格
2. 基于 PDF 文本块坐标（x/y）聚类提取表内值
3. 按行文本规则匹配预期行
4. 填入固定表格骨架（schema）
5. 若提取失败，标记为 degraded=true 并写入 warnings

### 2. StructuringService

**职责**：将解析结果整理成结构化数据模型

**主要方法**：
- `structureDocument(parseResult)`: 结构化文档
- `getTablesByChapter(document, chapterNumber)`: 获取特定章节的表格
- `getAllTables(document)`: 获取所有表格
- `getAllParagraphs(document)`: 获取所有段落
- `getContentByChapter(document, chapterNumber)`: 按章节获取内容
- `validateStructure(document)`: 验证结构完整性
- `generateSummary(document)`: 生成文档摘要

## 三张核心表格

### 1. 主动公开政府信息情况表（table_active_disclosure）

**位置**：第二章

**列**：
- `category` (string): 信息类别
- `count` (number): 公开条数

**预期行数**：3-10 行

### 2. 收到和处理政府信息公开申请情况表（table_foia_requests）

**位置**：第三章

**列**：
- `requestType` (string): 申请类型
- `requestCount` (number): 申请数量
- `processedCount` (number): 处理数量

**预期行数**：3-10 行

### 3. 政府信息公开行政复议、行政诉讼情况表（table_administrative_review）

**位置**：第四章

**列**：
- `itemType` (string): 事项类型
- `count` (number): 数量

**预期行数**：2-5 行

## 降级处理

### 完全失败
- 表格无法定位或提取
- 标记 `degraded=true`
- 写入 warning（code: `TABLE_PARSE_FAILED`）

### 部分失败
- 表格定位成功但某些行/列提取不完整
- 标记 `degraded=true`
- 写入 warning（code: `TABLE_ALIGN_PARTIAL`）

### 成功
- 所有行列都成功提取
- 标记 `degraded=false`

## 输出数据约束

### 稳定主键
- `tableId`: 表格唯一标识
- `rowId`: 行唯一标识
- `cellId`: 单元格唯一标识
- `colKey`: 列键

### 文本标准化
- 去除多余空白（前后空格、多余换行）
- 统一全角/半角（可选）
- 保留原始文本备查

### 可解释的降级
- 任何降级都必须通过 warnings 给出原因和影响范围
- Warning 必须包含 code、message、stage

## 测试

### 单元测试
- `src/services/__tests__/PdfParseService.test.ts`
- 覆盖：PDF 解析、表格提取、元数据提取、错误处理

### 集成测试
- `src/services/__tests__/integration.test.ts`
- 覆盖：完整流程、批量处理、表格降级、数据验证

### 运行测试
```bash
npm test -- PdfParseService
npm test -- integration
```

## 使用示例

### 解析 PDF
```typescript
import PdfParseService from './services/PdfParseService';

const result = await PdfParseService.parsePDF('/path/to/report.pdf', 'asset_123');
if (result.success) {
  console.log('解析成功');
  console.log('页数:', result.document?.metadata.totalPages);
  console.log('警告:', result.warnings);
}
```

### 结构化文档
```typescript
import StructuringService from './services/StructuringService';

const structureResult = await StructuringService.structureDocument(parseResult);
if (structureResult.success) {
  const summary = StructuringService.generateSummary(structureResult.document!);
  console.log('章节数:', summary.totalSections);
  console.log('表格数:', summary.totalTables);
}
```

### 获取特定章节的表格
```typescript
const chapter2Tables = StructuringService.getTablesByChapter(document, '二');
console.log('第二章表格:', chapter2Tables);
```

## 注意事项

1. **不追求视觉还原**：不需要还原 PDF 中的视觉表格样式，只需提取数据
2. **稳定性优先**：采用固定 Schema 确保解析稳定，而非追求完全泛化
3. **降级可解释**：任何降级都必须通过 warnings 给出原因和影响范围
4. **向后兼容**：Schema 更新时保持向后兼容，新增字段不影响现有解析

## 后续阶段

第四阶段（差异比对）将直接使用 Canonical Table JSON 进行 cell-level diff，无需额外处理。
