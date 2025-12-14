# 表格提取策略文档

## 当前状态

✅ **已完成：**
- 所有 6 个章节正确提取
- 表格结构识别（行数、列数正确）
- 后端架构改进（使用 AssetQueryService）
- 前端显示改进

❌ **待改进：**
- 表格数据提取（单元格内容为空）
- 段落文本提取

## 问题分析

### 根本原因
PDF 中的文本项没有坐标信息（x、y 都是 undefined），导致：
1. 无法按坐标重构页面文本
2. 无法将文本投影到表格单元格
3. 表格数据提取失败

### 当前方法的局限
- 依赖文本坐标信息
- 无法处理没有坐标的 PDF
- 无法识别网格线

## 改进策略

### Stage A: 网格线优先（推荐）

**优势：** 最准确，不依赖文本坐标

**步骤：**
1. 使用 `page.getOperatorList()` 提取 PDF 绘图操作
2. 从操作中识别线段（横线/竖线）
3. 聚类得到行边界和列边界（阈值 1~2px）
4. 获取页面文本内容
5. 将文本中心点投影到单元格
6. 按行列聚合单元格内容

**实现文件：** `src/services/AdvancedTableExtractor.ts`

### Stage B: 纯文本兜底

**优势：** 当没有网格线时仍可工作

**步骤：**
1. 按 Y 坐标聚类文本成行
2. 从表头推断列边界（或使用 schema 定义的列数）
3. 按列边界将文本分配到单元格
4. 合并同一单元格的多个文本项

## 实现计划

### Phase 1: 集成 AdvancedTableExtractor
- [ ] 完成 `getOperatorList()` 的线段提取
- [ ] 实现线段聚类算法
- [ ] 集成到 `PdfParseService`
- [ ] 测试网格线提取

### Phase 2: 改进纯文本提取
- [ ] 优化 Y 坐标聚类
- [ ] 改进列边界推断
- [ ] 处理合并单元格
- [ ] 测试纯文本提取

### Phase 3: 优化和调试
- [ ] 处理特殊情况（跨页表格、复杂表头等）
- [ ] 性能优化
- [ ] 完整测试

## 关键技术点

### 线段提取
```typescript
// 从 operatorList 中提取线段
const { fnArray, argsArray } = operatorList;
for (let i = 0; i < fnArray.length; i++) {
  if (fnArray[i] === 'S' || fnArray[i] === 's') {
    // 这是一个 stroke 操作
    // 需要追踪之前的 moveTo 和 lineTo 操作
  }
}
```

### 线段聚类
```typescript
// 聚类相近的线段
const threshold = 1; // 1-2px
const clusters = [];
for (const line of lines) {
  let foundCluster = false;
  for (const cluster of clusters) {
    if (Math.abs(line.y - cluster[0].y) < threshold) {
      cluster.push(line);
      foundCluster = true;
      break;
    }
  }
  if (!foundCluster) {
    clusters.push([line]);
  }
}
```

### 文本投影
```typescript
// 将文本投影到单元格
for (const item of textItems) {
  const x = item.x + item.width / 2;
  const y = item.y;
  
  // 找到对应的行和列
  const rowIndex = rowBorders.findIndex((b, i) => 
    i < rowBorders.length - 1 && y >= b && y < rowBorders[i + 1]
  );
  const colIndex = colBorders.findIndex((b, i) => 
    i < colBorders.length - 1 && x >= b && x < colBorders[i + 1]
  );
  
  if (rowIndex !== -1 && colIndex !== -1) {
    cells[rowIndex][colIndex] += item.str;
  }
}
```

## 测试计划

### 单元测试
- [ ] 线段提取测试
- [ ] 线段聚类测试
- [ ] 文本投影测试
- [ ] 列边界推断测试

### 集成测试
- [ ] 完整表格提取测试
- [ ] 多页表格测试
- [ ] 特殊格式表格测试

### 端到端测试
- [ ] 上传 PDF → 解析 → 显示
- [ ] 验证表格数据准确性

## 参考资源

- [PDF.js 文档](https://mozilla.github.io/pdf.js/)
- [getOperatorList() 说明](https://mozilla.github.io/pdf.js/api/js/module-pdfjsLib.PDFPageProxy.html#getOperatorList)
- [表格识别算法](https://github.com/topics/table-detection)

## 下一步

1. 完成 `AdvancedTableExtractor` 的实现
2. 集成到 `PdfParseService`
3. 创建测试脚本验证
4. 部署到生产环境

## 预期效果

完成后，系统将能够：
- ✅ 准确提取表格数据
- ✅ 处理各种 PDF 格式
- ✅ 支持跨页表格
- ✅ 显示完整的表格内容
