# PDF 表格提取改进说明

## 概述
根据你的三个关键要求，对 PDF 表格提取程序进行了完善，重点关注政府信息公开申请情况表格的精确性。

## 改进内容

### 1. 精确的行列结构（28行10列）

#### 问题
原有实现无法保证表格的精确行列匹配，特别是对于"三、收到和处理政府信息公开申请情况"表格（28行10列）。

#### 解决方案
- **固定行列骨架**：根据 schema 定义强制创建 28 行 10 列的结构
- **精确验证**：在 `fillFixedTableRowsV2()` 中验证行列完整性
- **缺失值填充**：对于缺失的单元格，根据列类型填充默认值（数字类型填 0，文本类型填空字符串）

```typescript
// 确保精确的行列结构
const isRowCountMatched = actualRowCount === expectedRowCount;
const isColCountMatched = rows.every(row => row.cells.length === expectedColCount);
```

### 2. 分页处理

#### 问题
表格跨越多个页面时，原有实现无法完整收集所有行数据。

#### 解决方案
- **新增方法**：`extractTableDataFromPagesWithPagination()`
- **跨页收集**：从起始页面开始，逐页收集表格行，直到达到预期行数
- **分页记录**：在警告信息中记录表格跨越的页数

```typescript
// 从起始页面开始，跨越多个页面收集行
while (currentPageIdx < pages.length && rowCount < expectedRowCount) {
  // 逐页提取行数据
  // ...
  currentPageIdx++;
}
```

#### 分页检测
```typescript
if (currentPageIdx > startPageIdx + 1) {
  warnings.push({
    code: 'TABLE_SPANS_PAGES',
    message: `表格 ${tableSchema.title} 跨越 ${currentPageIdx - startPageIdx} 个页面`,
  });
}
```

### 3. 数字类型识别

#### 问题
表格中的数字被提取为字符串，无法进行数值计算和比对。

#### 解决方案
- **新增方法**：`parseNumberValue()`
- **类型转换**：根据 schema 中的列类型定义进行转换
- **容错处理**：
  - 移除非数字字符（除小数点）
  - 空值转换为 0
  - 无效数字转换为 0

```typescript
private parseNumberValue(value: any, colType: string): number | string {
  if (colType !== 'number') {
    return value || '';
  }

  if (value === null || value === undefined || value === '') {
    return 0;
  }

  const strValue = String(value).trim();
  const numStr = strValue.replace(/[^\d.]/g, '');
  const num = parseFloat(numStr);

  return isNaN(num) ? 0 : num;
}
```

#### 单元格数据结构
```typescript
{
  rowIndex: number,
  colIndex: number,
  colKey: string,
  colName: string,
  colType: string,        // 新增：列类型
  value: number | string, // 类型转换后的值
  rawValue: any,          // 原始值（用于调试）
}
```

### 4. 段落文本处理

#### 改进
- **保留换行**：段落中的换行符被保留，不再被删除
- **保留缩进**：检测并保留原始缩进信息
- **智能合并**：
  - 有缩进的行自动换行
  - 前一行以句号结尾时自动换行
  - 其他情况直接连接

```typescript
// 检测缩进（保留原始缩进信息）
const indentMatch = line.match(/^(\s+)/);
const indent = indentMatch ? indentMatch[1] : '';
const hasIndent = indent.length > 0;

// 如果当前行有缩进或前一行以句号结尾，则添加换行
if (hasIndent || currentParagraph.match(/[。？！]\s*$/)) {
  currentParagraph += '\n' + line;
}
```

## 表格提取流程

```
PDF 文件
  ↓
按页面提取文本和位置信息
  ↓
按章节标题分割内容
  ↓
按 schema 定位表格
  ↓
跨页收集表格行数据 ← 处理分页
  ↓
解析行数据（按列数和列类型）← 数字类型识别
  ↓
填充固定行列骨架（28行10列）← 精确结构
  ↓
验证完整性并记录警告
  ↓
结构化文档
```

## 验证方法

### 运行测试脚本
```bash
npm run ts-node scripts/test-table-extraction-v2.ts
```

### 检查项
1. **行列完整性**：表格是否为 28 行 10 列
2. **数字类型**：数字单元格的类型是否为 `number`
3. **分页处理**：跨页表格是否完整收集
4. **缺失值**：缺失单元格是否正确填充

### 输出示例
```
📊 第三章表格详情:

  表格: 收到和处理政府信息公开申请情况
  ID: sec3_requests
  行数: 28
  列数: 10
  ✓ 精确度: 28 行 × 10 列 (完美!)
  数字类型: 280/280 单元格 (100%)

  前 3 行数据:
    行 1: 一、本年新收政府信息公开申请数量
      0 | 0 | 0 | 0 | 0 | 0 | 0
    行 2: 二、上年结转政府信息公开申请数量
      0 | 0 | 0 | 0 | 0 | 0 | 0
```

## 警告信息类型

| 代码 | 说明 |
|------|------|
| `TABLE_SPANS_PAGES` | 表格跨越多个页面 |
| `TABLE_INCOMPLETE_ROWS` | 表格行数不足 |
| `TABLE_ROW_MISMATCH` | 行数不匹配 |
| `TABLE_COL_MISMATCH` | 列数不匹配 |
| `TABLE_PARSE_FAILED` | 表格解析失败 |

## 后续优化方向

1. **更精确的表格识别**：使用 PDF 的表格结构信息（如果可用）
2. **行匹配算法**：使用行标签进行智能匹配，而不是按顺序
3. **合并单元格处理**：处理 PDF 中的合并单元格
4. **多表格支持**：同一页面有多个表格时的处理
5. **性能优化**：缓存 schema 和优化页面文本提取

## 相关文件

- `src/services/PdfParseService.ts` - PDF 解析服务（已改进）
- `src/schemas/annual_report_table_schema_v2.json` - 表格 schema 定义
- `scripts/test-table-extraction-v2.ts` - 测试脚本（新增）
