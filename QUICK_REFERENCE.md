# 快速参考指南

## 🚀 快速开始

### 1. 编译项目
```bash
npm run build
```
✅ 应该输出: 0 错误

### 2. 运行验证脚本
```bash
npx ts-node scripts/verify-implementation.ts
```
✅ 应该显示: 完整的比对流程和表格差异

### 3. 运行最小测试
```bash
npx ts-node scripts/test-pdf-minimal.ts
```
✅ 应该显示: PDF 解析结果

---

## 📊 核心功能

### PDF 解析
```typescript
import PdfParseService from './src/services/PdfParseService';

const result = await PdfParseService.parsePDF(filePath, assetId);
// result.document - 结构化文档
// result.warnings - 警告列表
```

### 文档结构化
```typescript
import StructuringService from './src/services/StructuringService';

const structResult = await StructuringService.structureDocument(parseResult);
// structResult.document - 增强的结构化文档
```

### 差异比对
```typescript
import DiffService from './src/services/DiffService';

const diffResult = await DiffService.diffDocuments(docA, docB);
// diffResult.sections - 差异章节列表
```

### 摘要生成
```typescript
import SummaryService from './src/services/SummaryService';

const summary = SummaryService.generateSummary(diffResult);
// summary.statistics - 统计数据
// summary.topChangedSections - 变化最多的章节
```

---

## 📋 Schema 信息

### 表格列表

| 章节 | 表格 ID | 行数 | 列数 | 说明 |
|------|--------|------|------|------|
| 二 | table_chapter2_section1 | 1 | 1 | 第（一）项 |
| 二 | table_chapter2_section5 | 1 | 2 | 第（五）项 |
| 二 | table_chapter2_section6 | 1 | 2 | 第（六）项 |
| 二 | table_chapter2_section8 | 1 | 2 | 第（八）项 |
| 三 | table_chapter3_foia_requests | 25 | 7 | 申请处理情况 |
| 四 | table_chapter4_administrative_review | 1 | 15 | 复议诉讼情况 |

### 章节三的 25 行标签

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

---

## 🔍 数据结构

### StructuredDocument
```typescript
{
  documentId: string;
  assetId: string;
  title: string;
  sections: Section[];
  metadata: {
    totalPages: number;
    extractedAt: Date;
    parseVersion: string;
  };
}
```

### Table
```typescript
{
  id: string;
  title?: string;
  rows: TableRow[];
  columns: number;
}
```

### TableRow
```typescript
{
  id: string;
  rowIndex: number;
  rowLabel?: string;      // 来自 schema
  cells: TableCell[];
}
```

### TableCell
```typescript
{
  id: string;
  rowIndex: number;
  colIndex: number;
  colKey?: string;        // 来自 schema
  colName?: string;       // 来自 schema
  content: string;
}
```

### CellChange
```typescript
{
  rowIndex: number;
  colIndex: number;
  rowLabel?: string;      // 来自 schema
  colName?: string;       // 来自 schema
  type: 'added' | 'deleted' | 'modified';
  before?: string;
  after?: string;
}
```

---

## ⚠️ 常见问题

### Q: 如何处理 PDF 解析失败？
A: 检查 `parseResult.warnings` 中的警告信息，特别是 `code=TABLE_SCHEMA_MISS` 的警告。

### Q: 表格为什么显示为 degraded=true？
A: 这表示表格提取不完整，可能是 PDF 格式问题或表格结构不符合预期。

### Q: 如何获取可读的表格差异？
A: 使用 `cellChange.rowLabel` 和 `cellChange.colName` 组合输出：
```typescript
`${change.rowLabel} / ${change.colName}: ${change.before} → ${change.after}`
```

### Q: 如何添加新的表格到 schema？
A: 编辑 `src/schemas/annual_report_table_schema_v2.json`，添加新的 table 对象。

---

## 📁 重要文件

| 文件 | 说明 |
|------|------|
| `src/schemas/annual_report_table_schema_v2.json` | Schema 定义 |
| `src/schemas/README.md` | Schema 说明文档 |
| `src/services/PdfParseService.ts` | PDF 解析服务 |
| `src/services/DiffService.ts` | 差异比对服务 |
| `src/services/StructuringService.ts` | 文档结构化服务 |
| `src/services/SummaryService.ts` | 摘要生成服务 |
| `scripts/verify-implementation.ts` | 验证脚本 |
| `IMPLEMENTATION_GUIDE.md` | 详细实现指南 |

---

## 🔗 相关文档

- [实现指南](./IMPLEMENTATION_GUIDE.md) - 详细的技术实现说明
- [Schema 说明](./src/schemas/README.md) - Schema 结构和使用方法
- [第四阶段完成总结](./PHASE4_COMPLETION.md) - 阶段工作总结
- [最终实现报告](./FINAL_IMPLEMENTATION_REPORT.md) - 完整的实现报告

---

## ✅ 验证清单

在部署前，请确保：

- [ ] npm run build 通过（0 错误）
- [ ] npx ts-node scripts/verify-implementation.ts 成功运行
- [ ] 至少有 2 个 PDF 文件在 fixtures/sample_pdfs_v1/ 目录
- [ ] 所有表格都能正确提取（检查 warnings）
- [ ] 差异比对能正确显示 rowLabel 和 colName

---

**最后更新**: 2025-01-13  
**版本**: 2.0  
**状态**: ✅ 生产就绪
