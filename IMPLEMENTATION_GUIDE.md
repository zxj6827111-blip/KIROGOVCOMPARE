# 年报三表固定输出实现指南

## 概述

本文档说明如何使用本系统进行政府信息公开年度报告的差异比对，特别是年报三表（章节二、三、四）的固定行列结构提取和差异分析。

## 核心改进

### 1. Schema v2 - 固定行列结构

新增 `src/schemas/annual_report_table_schema_v2.json`，定义了年报三表的固定行列结构：

#### 章节二 - 主动公开政府信息情况（4 个子表）
- **第（一）项**: 1 行 × 1 列 - 主动公开条数
- **第（五）项**: 1 行 × 2 列 - 信息类别、公开条数
- **第（六）项**: 1 行 × 2 列 - 公开形式、公开条数
- **第（八）项**: 1 行 × 2 列 - 公开渠道、访问次数

#### 章节三 - 收到和处理政府信息公开申请情况
- **固定 25 行** × **7 列**
- 行标签: 收到申请数、当面申请、邮件申请、电话申请、网络申请、其他方式、对上年度分类未当场处理的申请的处理、收到申请总数、已全部公开、已部分公开、不予公开、信息不存在、申请内容不明确、不是《条例》所指信息、法律法规禁止公开、其他原因、处理申请总数、结转下年度继续处理、平均处理时间、最长处理时间、行政复议申请数、行政诉讼案件数、举报投诉数、其他、总计
- 列: 自然人、法人或其他组织、媒体、教育科研机构、其他、总计

#### 章节四 - 政府信息公开行政复议、行政诉讼情况
- **固定 1 行** × **15 列**
- 列: 复议申请数、复议中止数、复议撤销数、复议维持数、复议其他数、诉讼案件数、诉讼中止数、诉讼撤诉数、诉讼驳回数、诉讼维持数、诉讼撤销数、诉讼其他数、复议和诉讼总数、平均处理时间、最长处理时间

### 2. PdfParseService 增强

#### 固定行列填充算法
```
1. 定位表格 (按 titleKeywords)
2. 坐标聚类提取行列
3. 按 rowLabels 匹配行
4. 按 columns 匹配列
5. 创建固定大小骨架
6. 填充提取的数据
7. 未匹配单元格填空
8. 记录 warnings (TABLE_SCHEMA_MISS)
```

#### 关键方法
- `createEmptyTableRows()` - 创建空的固定行列骨架
- `fillFixedTableRows()` - 填充固定行列结构
- 支持 `fixedRows` 标志区分灵活和固定结构

### 3. DiffService 增强

#### 单元格变化增加元数据
```typescript
interface CellChange {
  rowIndex: number;
  colIndex: number;
  rowLabel?: string;      // 行标签（来自 schema）
  colName?: string;       // 列名（来自 schema）
  type: DiffType;
  before?: string;
  after?: string;
}
```

#### 可读的差异输出格式
```
[修改] 收到申请数 / 自然人: "100" → "150"
[新增] 当面申请 / 法人或其他组织: "50"
[删除] 邮件申请 / 媒体: "30"
```

### 4. DocxExportService 增强

在导出 DOCX 时，使用 rowLabel 和 colName 生成可读的表格差异清单：

```
表格: 收到和处理政府信息公开申请情况

变化详情:
- 行: 收到申请数, 列: 自然人
  旧值: 100
  新值: 150
  
- 行: 当面申请, 列: 法人或其他组织
  新增: 50
```

## 使用流程

### 1. 准备 PDF 文件

将两份不同年度的政府信息公开年度报告 PDF 放在 `fixtures/sample_pdfs_v1/` 目录下。

### 2. 运行最小测试

```bash
# 编译
npm run build

# 运行 PDF 解析测试
npx ts-node scripts/test-pdf-minimal.ts

# 运行完整比对流程测试
npx ts-node scripts/test-compare-flow.ts
```

### 3. 查看输出

完整比对流程测试会输出：
- ✅ PDF 解析结果（章节数、表格数）
- ✅ 文档结构化结果
- ✅ 差异统计（段落、表格变化数）
- ✅ 摘要信息（变化最多的章节）
- ✅ 表格差异详情（含行标签、列名）

### 4. 集成到应用

在 API 中使用完整流程：

```typescript
// 1. 解析两个 PDF
const result1 = await PdfParseService.parsePDF(pathA, assetIdA);
const result2 = await PdfParseService.parsePDF(pathB, assetIdB);

// 2. 结构化
const struct1 = await StructuringService.structureDocument(result1);
const struct2 = await StructuringService.structureDocument(result2);

// 3. 比对
const diff = await DiffService.diffDocuments(struct1.document, struct2.document);

// 4. 生成摘要
const summary = SummaryService.generateSummary(diff);

// 5. 导出 DOCX（包含表格差异详情）
const docxPath = await DocxExportService.generateDiffReport(diff, summary);
```

## 数据结构

### StructuredDocument 中的表格

```typescript
interface Table {
  id: string;                    // 表格 ID
  title: string;                 // 表格标题
  rows: TableRow[];              // 行数据
  columns: number;               // 列数
  rowLabels?: string[];          // 行标签（来自 schema）
  colNames?: string[];           // 列名（来自 schema）
  degraded?: boolean;            // 是否降级
  warnings?: Warning[];          // 警告列表
}

interface TableRow {
  id: string;
  rowIndex: number;
  rowLabel?: string;             // 行标签
  cells: TableCell[];
}

interface TableCell {
  id: string;
  rowIndex: number;
  colIndex: number;
  colKey?: string;               // 列键
  colName?: string;              // 列名
  content: string;               // 单元格内容
}
```

## 警告处理

### TABLE_SCHEMA_MISS

当表格提取不完整时，系统会记录 `TABLE_SCHEMA_MISS` 警告：

```typescript
{
  code: 'TABLE_SCHEMA_MISS',
  message: '表格行数不匹配（期望 25 行，实际 20 行）',
  stage: 'parsing',
  section: '收到和处理政府信息公开申请情况'
}
```

### 处理策略

1. **记录警告** - 不中断处理流程
2. **填充骨架** - 未匹配的单元格填空
3. **标记降级** - 设置 `degraded=true`
4. **继续处理** - 任务仍为 `succeeded`

## 性能优化

### 缓存复用

同一资产多次使用时，解析结果会被缓存：

```typescript
// 第一次：执行完整解析
const result1 = await PdfParseService.parsePDF(path, assetId);

// 第二次：从缓存读取
const result2 = await PdfParseService.parsePDF(path, assetId);
// 缓存命中，避免重复解析
```

### 批量比对

管理员可以批量比对多对资产，系统会自动复用解析缓存：

```typescript
// 批量比对 10 对资产
// 如果有重复资产，只解析一次
const batchJob = await BatchJobService.runBatchJob({
  pairs: [
    { assetIdA: 'asset_1', assetIdB: 'asset_2' },
    { assetIdA: 'asset_1', assetIdB: 'asset_3' },  // asset_1 复用缓存
    // ...
  ]
});
```

## 故障排查

### 问题：表格提取为空

**原因**: PDF 中的表格结构与 schema 定义不匹配

**解决**:
1. 检查 PDF 中的表格标题是否包含 `titleKeywords`
2. 查看 warnings 中的 `TABLE_SCHEMA_MISS` 信息
3. 调整 schema 中的 `titleKeywords` 或 `rowLabels`

### 问题：单元格内容不正确

**原因**: PDF 文本块坐标聚类不准确

**解决**:
1. 调整 `extractTableRows()` 中的 `yThreshold` 值
2. 增加调试日志查看坐标分布
3. 手动验证 PDF 中的表格结构

### 问题：性能缓慢

**原因**: 大量 PDF 文件重复解析

**解决**:
1. 启用解析缓存（默认启用）
2. 使用批量比对而非逐个比对
3. 检查 Redis 缓存是否正常工作

## 扩展指南

### 添加新的表格

1. 在 `schema_v2.json` 中添加新表格定义
2. 定义 `tableId`、`titleKeywords`、`columns`、`rowLabels`
3. 设置 `fixedRows=true` 和 `rowCount`
4. 更新 `parseVersion` 版本号

### 修改现有表格

1. 更新 schema 中的 `columns` 或 `rowLabels`
2. 增加 `parseVersion` 版本号
3. 旧版本缓存会自动失效
4. 下次解析时使用新 schema

## 参考资源

- [Schema 说明](src/schemas/README.md)
- [PDF 解析服务](src/services/PdfParseService.ts)
- [差异比对服务](src/services/DiffService.ts)
- [DOCX 导出服务](src/services/DocxExportService.ts)
- [测试脚本](scripts/test-compare-flow.ts)

## 下一步

1. ✅ 完成 schema v2 定义
2. ✅ 实现固定行列填充算法
3. ✅ 增加 rowLabel/colName 元数据
4. ⏳ 完成 DOCX 导出的表格差异清单
5. ⏳ 添加 API 集成测试
6. ⏳ 部署到测试环境

