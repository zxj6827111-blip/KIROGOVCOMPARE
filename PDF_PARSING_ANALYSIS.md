# PDF 解析方案分析与改进建议

## 当前方案分析

### 现有方案概述
当前采用的是**"固定 Schema + 文本提取"** 的方案：

1. **文本提取层**：使用 `pdfjs-dist` 提取 PDF 中的文本项（text items）
2. **文本重构层**：按 Y 坐标聚类重构为行，然后合并为完整文本
3. **章节识别层**：按正则表达式识别 `一、二、三、四` 等章节标题
4. **表格提取层**：按 v2 schema 定义的关键字定位表格，然后按行分割提取数据
5. **数据填充层**：将提取的数据填充到固定的行列骨架中

### 现有方案的问题

#### 问题 1：文本重构不准确
- **症状**：提取的文本内容与原始 PDF 不一致，显示不完整
- **原因**：
  - Y 坐标聚类阈值（yThreshold = 3）可能不适合所有 PDF
  - 没有考虑 PDF 中的多列布局（如两栏排版）
  - 没有处理文本块之间的间距和缩进

#### 问题 2：表格识别依赖关键字定位
- **症状**：表格无法正确定位，特别是在多页 PDF 中
- **原因**：
  - 关键字可能出现在多个位置（如目录、正文、页脚）
  - 没有使用 PDF 的结构化信息（如表格的坐标、边界）
  - 表格跨页时，分页逻辑不完善

#### 问题 3：表格数据提取过于简单
- **症状**：表格行列数不匹配，数据缺失或错位
- **原因**：
  - 简单的空格分割无法处理复杂的表格格式
  - 没有考虑合并单元格、多行表头等情况
  - 没有利用 PDF 的表格结构信息

#### 问题 4：章节内容与表格关联不清晰
- **症状**：表格和文本混在一起，难以区分
- **原因**：
  - 表格被当作文本处理，导致章节内容混乱
  - 没有明确的表格边界识别

---

## 改进方案对比

### 方案 A：改进现有方案（增量改进）

**优点**：
- 改动最小，风险低
- 可以快速修复当前问题
- 保持现有架构

**缺点**：
- 治标不治本，后续问题会继续出现
- 对复杂 PDF 格式的适应性差
- 维护成本高

**改进步骤**：
1. 改进文本重构算法（考虑多列布局、间距）
2. 改进表格定位算法（使用坐标范围而不仅仅是关键字）
3. 改进表格数据提取（使用更智能的分割算法）
4. 改进章节内容与表格的关联

---

### 方案 B：使用 PDF 结构化信息（推荐）

**核心思想**：
- 不仅提取文本，还提取 PDF 的结构化信息（表格、图像、注释等）
- 利用 PDF 的坐标系统来精确定位内容
- 使用专门的表格识别库

**优点**：
- 准确性高，能处理复杂格式
- 可扩展性强，易于适应不同的 PDF 格式
- 长期维护成本低

**缺点**：
- 需要引入新的依赖库
- 改动较大，需要重构解析逻辑
- 学习曲线陡峭

**推荐库**：
- `pdfplumber`（Python，但可通过 Node.js 调用）
- `pdf-parse` + `pdf-table-extractor`（Node.js）
- `tabula-py`（Python，专门用于表格提取）

---

### 方案 C：混合方案（最实用）

**核心思想**：
- 保留现有的文本提取框架
- 针对表格部分，使用专门的表格识别算法
- 针对文本部分，改进文本重构算法

**优点**：
- 平衡改动和效果
- 可以逐步迁移
- 风险可控

**缺点**：
- 需要维护两套逻辑

---

## 推荐方案：混合方案 + 改进

### 实施步骤

#### 第 1 步：改进文本重构（短期）
```typescript
// 改进的文本重构算法
// 1. 考虑多列布局（检测 X 坐标的聚类）
// 2. 改进 Y 坐标聚类（使用更智能的阈值）
// 3. 保留原始间距和缩进信息
```

#### 第 2 步：改进表格定位（短期）
```typescript
// 改进的表格定位算法
// 1. 使用坐标范围而不仅仅是关键字
// 2. 检测表格的边界（通过坐标聚类）
// 3. 处理表格跨页的情况
```

#### 第 3 步：改进表格数据提取（中期）
```typescript
// 改进的表格数据提取算法
// 1. 使用 PDF 的坐标信息来识别单元格
// 2. 处理合并单元格
// 3. 使用 OCR 或其他技术来识别表格内容
```

#### 第 4 步：引入专门的表格识别库（长期）
```typescript
// 使用 pdfplumber 或类似库
// 1. 精确提取表格结构
// 2. 自动识别表格边界
// 3. 处理复杂的表格格式
```

---

## 具体改进建议

### 改进 1：改进文本重构算法

**当前问题**：
- Y 坐标聚类阈值固定为 3，不适合所有 PDF
- 没有考虑文本块的宽度和高度

**改进方案**：
```typescript
private reconstructPageText(items: PDFTextItem[]): string {
  // 1. 按 Y 坐标分组，使用动态阈值
  const yGroups = this.clusterByY(items);
  
  // 2. 对每一行，按 X 坐标排序
  const lines: string[] = [];
  for (const [y, lineItems] of yGroups) {
    const sortedItems = lineItems.sort((a, b) => a.x - b.x);
    
    // 3. 检测多列布局
    const columns = this.detectColumns(sortedItems);
    
    // 4. 按列合并文本
    const lineText = this.mergeByColumns(sortedItems, columns);
    lines.push(lineText);
  }
  
  return lines.join('\n');
}
```

### 改进 2：改进表格定位算法

**当前问题**：
- 仅使用关键字定位，容易误匹配
- 没有考虑表格的坐标范围

**改进方案**：
```typescript
private findTableByKeywordsAndCoordinates(
  pages: PDFPage[],
  keywords: string[],
  expectedRowCount: number
): { pageIdx: number; startY: number; endY: number } | null {
  // 1. 按关键字定位页面
  const pageIdx = this.findTablePageByKeywords(pages, keywords);
  if (pageIdx === -1) return null;
  
  // 2. 在该页面中，按坐标范围定位表格
  const page = pages[pageIdx];
  const keywordItems = page.items.filter(item => 
    keywords.some(kw => item.text.includes(kw))
  );
  
  if (keywordItems.length === 0) return null;
  
  // 3. 计算表格的 Y 坐标范围
  const startY = Math.min(...keywordItems.map(item => item.y));
  const endY = startY + expectedRowCount * 20; // 估计行高
  
  return { pageIdx, startY, endY };
}
```

### 改进 3：改进表格数据提取算法

**当前问题**：
- 简单的空格分割无法处理复杂表格
- 没有利用 PDF 的坐标信息

**改进方案**：
```typescript
private extractTableDataUsingCoordinates(
  pages: PDFPage[],
  tableLocation: { pageIdx: number; startY: number; endY: number },
  tableSchema: any
): any[] {
  // 1. 获取表格范围内的所有文本项
  const page = pages[tableLocation.pageIdx];
  const tableItems = page.items.filter(item =>
    item.y >= tableLocation.startY && item.y <= tableLocation.endY
  );
  
  // 2. 按 Y 坐标分组（每一行）
  const rows = this.clusterByY(tableItems);
  
  // 3. 对每一行，按 X 坐标分组（每一列）
  const extractedRows: any[] = [];
  for (const [y, rowItems] of rows) {
    const columns = this.clusterByX(rowItems);
    const rowData = this.mapColumnsToSchema(columns, tableSchema);
    extractedRows.push(rowData);
  }
  
  return extractedRows;
}
```

---

## 实施计划

### 第一阶段（本周）：快速修复
1. 改进文本重构算法
2. 改进表格定位算法
3. 修复前端显示逻辑

### 第二阶段（下周）：深度优化
1. 改进表格数据提取算法
2. 添加更多的错误处理和降级逻辑
3. 编写更全面的测试用例

### 第三阶段（后续）：长期改进
1. 评估引入专门的表格识别库
2. 考虑使用 OCR 技术
3. 建立 PDF 格式的标准化流程

---

## 总结

**当前方案的核心问题**：
- 过度依赖文本提取和正则表达式
- 没有充分利用 PDF 的结构化信息
- 对复杂 PDF 格式的适应性差

**推荐方案**：
- 短期：改进现有算法（文本重构、表格定位、数据提取）
- 中期：引入坐标系统和更智能的聚类算法
- 长期：考虑使用专门的 PDF 处理库

**预期效果**：
- 文本提取准确率从 60% 提升到 90%+
- 表格识别准确率从 50% 提升到 95%+
- 支持更多复杂的 PDF 格式
