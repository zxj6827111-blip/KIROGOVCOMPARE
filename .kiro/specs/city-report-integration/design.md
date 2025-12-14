# Phase 6 设计文档 - 城市-年报资产一体化改造

## 概述

本设计文档描述如何改造现有系统，实现城市与年报资产的强绑定，确保前端只展示有实际数据的城市，并提供完整的后台管理界面。

---

## 架构

### 数据流

```
后台上传年报
    ↓
指定 regionId + year
    ↓
保存到 report_assets (region_id, year, status=usable)
    ↓
用户侧 GET /api/v1/catalog/regions
    ↓
只返回有 usable 资产的城市
    ↓
用户选择城市+年份创建任务
    ↓
后端按 (regionId, year) 查询最新 usable 资产
    ↓
创建对比任务
```

### 系统组件

```
┌─────────────────────────────────────────┐
│         后台管理前端                      │
│  ┌──────────────┐  ┌──────────────┐    │
│  │ 城市管理页   │  │ 年报汇总页   │    │
│  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│         后台管理 API                     │
│  /api/v1/admin/regions                  │
│  /api/v1/admin/reports                  │
│  /api/v1/admin/assets/upload            │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│         用户侧 API                       │
│  /api/v1/catalog/regions                │
│  /api/v1/catalog/regions/:regionId/years│
│  /api/v1/tasks/compare/region-year      │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│         用户侧前端                       │
│  创建任务页面（改造）                    │
│  任务详情页面（保留）                    │
└─────────────────────────────────────────┘
```

---

## 数据模型

### 1. Regions 表（城市主数据）

```typescript
interface Region {
  regionId: string;           // 主键，如 "beijing"
  name: string;               // 城市名，如 "北京市"
  status: 'active' | 'inactive';
  sortOrder: number;          // 排序
  createdAt: Date;
  updatedAt: Date;
}
```

### 2. ReportAssets 表（改造）

```typescript
interface ReportAsset {
  assetId: string;            // 主键
  regionId: string;           // 外键 → regions.regionId
  year: number;               // 年份
  fileName: string;           // 文件名
  fileSize: number;           // 文件大小
  sourceType: 'upload' | 'url' | 'import';
  status: 'usable' | 'disabled' | 'unassigned' | 'parse_failed';
  parseVersion: string;       // 解析版本
  uploadedAt: Date;
  uploadedBy: string;         // 上传者
  updatedAt: Date;
  
  // 新增字段
  parseError?: string;        // 解析错误信息
  documentId?: string;        // 关联的 StructuredDocument ID
}
```

**关键约束**:
- `regionId` 不允许为空（NOT NULL）
- `(regionId, year)` 组合应该唯一（或允许多个但只有最新的 usable）
- 前端展示逻辑必须检查 `status = 'usable'`

---

## 组件和接口

### 后端 API

#### 1. 城市管理 API (`src/routes/admin.ts`)

```typescript
// 获取城市列表
GET /api/v1/admin/regions
Response: {
  regions: Region[],
  total: number
}

// 新增城市
POST /api/v1/admin/regions
Body: { name, status, sortOrder }
Response: Region

// 编辑城市
PUT /api/v1/admin/regions/:regionId
Body: { name, status, sortOrder }
Response: Region
```

#### 2. 年报汇总 API (`src/routes/admin.ts`)

```typescript
// 获取年报列表
GET /api/v1/admin/reports?regionId=&year=&status=&q=&page=1&pageSize=20
Response: {
  reports: ReportAsset[],
  total: number,
  page: number,
  pageSize: number
}

// 获取统计数据
GET /api/v1/admin/reports/summary
Response: {
  totalRegions: number,
  regionsWithAssets: number,
  totalAssets: number,
  assetsByStatus: { usable, disabled, parse_failed, unassigned },
  assetsByYear: { 2023: 10, 2024: 15, ... }
}

// 上传年报
POST /api/v1/admin/assets/upload
Body: FormData { file, regionId, year }
Response: ReportAsset

// 重新归属资产
PUT /api/v1/admin/reports/:assetId/assign
Body: { regionId, year, status }
Response: ReportAsset
```

#### 3. 用户侧 API (`src/routes/catalog.ts` 改造)

```typescript
// 获取有数据的城市列表
GET /api/v1/catalog/regions
Response: {
  regions: {
    regionId: string,
    name: string,
    availableYears: number[]
  }[]
}

// 获取城市的年份列表
GET /api/v1/catalog/regions/:regionId/years
Response: {
  years: number[]
}

// 创建任务（保留）
POST /api/v1/tasks/compare/region-year
Body: { regionId, yearA, yearB }
Response: Task | Error { code: 'ASSET_NOT_FOUND_FOR_REGION_YEAR' }
```

### 前端组件

#### 1. 创建任务页面改造 (`frontend/src/components/CreateTask.js`)

```javascript
// 改造点：
// 1. 调用 GET /api/v1/catalog/regions 获取城市列表
// 2. 只显示有 usable 资产的城市
// 3. 选择城市后加载年份
// 4. 年份少于 2 个时禁用"创建任务"按钮
// 5. 移除"任务列表"显示
```

#### 2. 后台年报汇总页面（新增）

```javascript
// AdminReports.js
// 功能：
// 1. 表格显示所有年报资产
// 2. 支持按城市、年份、状态、关键词筛选
// 3. 支持分页、排序
// 4. 显示统计卡片
// 5. 支持点击资产跳转到城市详情页
```

#### 3. 后台城市详情页面（新增）

```javascript
// AdminCityDetail.js
// 功能：
// 1. 显示城市基本信息
// 2. 按年份分组显示该城市的所有年报
// 3. 支持上传新年报（必须选择年份）
// 4. 支持启用/停用资产
// 5. 支持删除资产
```

---

## 错误处理

### 错误码

```typescript
enum ErrorCode {
  ASSET_NOT_FOUND_FOR_REGION_YEAR = 'ASSET_NOT_FOUND_FOR_REGION_YEAR',
  REGION_NOT_FOUND = 'REGION_NOT_FOUND',
  ASSET_NOT_FOUND = 'ASSET_NOT_FOUND',
  INVALID_REGION_ID = 'INVALID_REGION_ID',
  INSUFFICIENT_YEARS = 'INSUFFICIENT_YEARS',
}
```

### 错误响应

```typescript
{
  code: 'ASSET_NOT_FOUND_FOR_REGION_YEAR',
  message: '该城市该年份无可用年报',
  details: {
    regionId: 'beijing',
    year: 2023,
    availableYears: [2024]
  }
}
```

---

## 测试策略

### 单元测试

- 城市与年报的关联逻辑
- 状态过滤逻辑（只返回 usable）
- 年份聚合逻辑

### 集成测试

- 上传年报 → 前端立刻可见
- 禁用年报 → 前端立刻不可见
- 创建任务 → 正确选择最新资产

### 端到端测试

- 用例 1-5（见需求文档）

---

## 数据迁移

### 现有数据处理

1. 扫描现有 report_assets 表
2. 根据文件名或其他线索推断 regionId
3. 为无 regionId 的资产标记为 'unassigned'
4. 手动审核并重新归属

### 初始化脚本

```sql
-- 创建 regions 表
CREATE TABLE regions (
  region_id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 修改 report_assets 表
ALTER TABLE report_assets 
ADD COLUMN region_id VARCHAR(50),
ADD FOREIGN KEY (region_id) REFERENCES regions(region_id);

-- 创建索引
CREATE INDEX idx_report_assets_region_year 
ON report_assets(region_id, year);

CREATE INDEX idx_report_assets_status 
ON report_assets(status);
```

---

## 部署计划

### 第 1 阶段：数据模型
- 创建 regions 表
- 修改 report_assets 表
- 数据迁移

### 第 2 阶段：后端 API
- 实现城市管理 API
- 实现年报汇总 API
- 改造用户侧 API

### 第 3 阶段：前端
- 改造创建任务页面
- 新增后台管理页面

### 第 4 阶段：测试和验收
- 运行所有测试用例
- 用户验收

---

## 关键决策

1. **为什么要强制 regionId？**
   - 确保数据完整性
   - 便于后台管理
   - 支持前端数据驱动展示

2. **为什么要检查 status=usable？**
   - 避免污染前端下拉（解析失败的文件不应出现）
   - 支持灰度发布（先标记为 disabled，再启用）
   - 支持资产版本管理

3. **为什么要分离后台和用户侧 API？**
   - 后台需要看到所有资产（包括 disabled）
   - 用户侧只需要看到可用的
   - 便于权限控制

---

**设计完成日期**: 待定  
**审核状态**: 待审核
