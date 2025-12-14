# 第五阶段需求 - 完整系统改造

**状态**: 规划中  
**优先级**: 高  
**预计工作量**: 大

## 📋 需求概览

### 核心问题
1. 创建任务流程不符合需求（需要改为"选择城市+年份"）
2. 详情页缺少全文对照和表格对照功能
3. 表格对比未按 Schema 固定结构输出
4. 管理后台缺少资源管理模块

### 目标效果
- ✅ 用户只需选择城市和年份即可创建任务
- ✅ 详情页支持全文对照、表格对照、摘要三个 Tab
- ✅ 支持差异高亮、只看差异、高亮相同等开关
- ✅ 表格按 Schema 固定结构并排显示
- ✅ 管理后台显示城市/年份资源情况

## 🎯 分阶段任务

### 第一阶段：后端基础改造（必须先做）

#### 1.1 城市-年份索引 API
```
GET /api/v1/catalog/regions
  返回: { regions: [{name, availableYears, isComplete}] }

GET /api/v1/catalog/years?region=XXX
  返回: { years: [2023, 2024, ...] }

POST /api/v1/tasks/compare/region-year
  入参: { region, yearA, yearB }
  返回: { taskId, status, message }
```

#### 1.2 PDF 解析增强
- 真正抽取全文内容（不是占位符）
- 按 Schema 固定输出 6 张表格
- 生成完整的 StructuredDocument

#### 1.3 Diff 视图模型
```
GET /api/v1/tasks/:taskId/view-model
  返回: {
    sections: [{
      title,
      blocks: [
        { type: 'paragraph', beforeText, afterText, status, inlineDiff },
        { type: 'table', schemaTableId, tableA, tableB, cellDiffs }
      ]
    }]
  }
```

### 第二阶段：前端改造

#### 2.1 创建任务页
- 改为下拉选择城市、年份 A、年份 B
- 隐藏 URL/上传入口（折叠高级选项）
- 调用新 API: POST /api/v1/tasks/compare/region-year

#### 2.2 详情页改造
- 摘要 Tab（保留现有）
- 全文对照 Tab（新增）
  - 左右并排显示
  - 支持三个开关：只看差异、高亮差异、高亮相同
- 表格对照 Tab（新增）
  - 左右并排显示表格
  - 单元格差异高亮
  - 下方显示指标分析表

### 第三阶段：数据与种子

#### 3.1 使用 fixtures 数据
- 扫描 fixtures/sample_pdfs_v1 中的 PDF
- 从文件名提取城市和年份信息
- 入库为 report_assets

#### 3.2 创建索引表
- 城市-年份映射
- 资产可用性标记

## 📊 技术方案

### 后端改造清单

| 任务 | 文件 | 优先级 |
|------|------|--------|
| 新增 Catalog API | src/routes/catalog.ts | P0 |
| 修改 PDF 解析 | src/services/PdfParseService.ts | P0 |
| 新增 Diff 视图模型 | src/services/DiffViewService.ts | P0 |
| 修改任务创建 API | src/routes/tasks.ts | P0 |
| 数据库迁移 | migrations/002_add_catalog.sql | P1 |

### 前端改造清单

| 任务 | 文件 | 优先级 |
|------|------|--------|
| 改造创建任务页 | frontend/src/components/CreateTask.js | P0 |
| 新增全文对照 Tab | frontend/src/components/TextComparison.js | P0 |
| 新增表格对照 Tab | frontend/src/components/TableComparison.js | P0 |
| 改造详情页 | frontend/src/components/TaskDetail.js | P0 |

## 🔄 实现顺序

1. **后端 API 设计** → 2. **PDF 解析增强** → 3. **Diff 视图模型** → 4. **前端改造** → 5. **数据种子** → 6. **集成测试**

## ✅ 验收标准

- [ ] 用户可通过城市+年份创建任务
- [ ] 详情页显示全文对照（并排、可切换开关）
- [ ] 详情页显示表格对照（按 Schema、差异高亮）
- [ ] 管理后台显示城市/年份资源
- [ ] 用 fixtures 数据一键创建任务并查看对照

## 📝 下一步

等待确认后，按优先级逐步实现。建议先从后端 API 开始。
