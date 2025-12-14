# Phase 6 实现计划 - 城市-年报资产一体化改造

## 任务清单

### 1. 数据模型改造

- [ ] 1.1 创建 Region 模型和数据库表
  - 创建 `src/models/Region.ts`
  - 创建数据库迁移脚本
  - 字段：regionId, name, status, sortOrder, createdAt, updatedAt
  - _需求: 1_

- [ ] 1.2 改造 ReportAsset 模型
  - 修改 `src/models/ReportAsset.ts`
  - 添加 region_id 外键（NOT NULL）
  - 添加 parseError 字段
  - 添加 documentId 字段
  - _需求: 1_

- [ ] 1.3 创建数据库迁移脚本
  - 创建 `migrations/002_add_regions_and_region_id.sql`
  - 创建 regions 表
  - 修改 report_assets 表添加 region_id
  - 创建索引
  - _需求: 1_

- [ ] 1.4 数据迁移脚本
  - 创建 `scripts/migrate-assets-to-regions.ts`
  - 扫描现有资产，推断 regionId
  - 标记无法推断的为 unassigned
  - _需求: 1_

### 2. 后端 API - 城市管理

- [ ] 2.1 创建城市管理路由
  - 创建 `src/routes/admin.ts`
  - 实现 GET /api/v1/admin/regions
  - 实现 POST /api/v1/admin/regions
  - 实现 PUT /api/v1/admin/regions/:regionId
  - _需求: 2_

- [ ] 2.2 创建城市服务
  - 创建 `src/services/RegionService.ts`
  - 实现城市 CRUD 操作
  - 实现城市排序逻辑
  - _需求: 2_

### 3. 后端 API - 年报汇总

- [ ] 3.1 实现年报列表 API
  - 在 `src/routes/admin.ts` 中实现 GET /api/v1/admin/reports
  - 支持按 regionId、year、status、关键词筛选
  - 支持分页排序（默认 uploadedAt desc）
  - _需求: 2_

- [ ] 3.2 实现年报统计 API
  - 在 `src/routes/admin.ts` 中实现 GET /api/v1/admin/reports/summary
  - 返回聚合统计数据
  - _需求: 2_

- [ ] 3.3 实现年报上传 API
  - 在 `src/routes/admin.ts` 中实现 POST /api/v1/admin/assets/upload
  - 必须指定 regionId 和 year
  - 支持替换同年旧版本
  - _需求: 2_

- [ ] 3.4 实现资产重新归属 API
  - 在 `src/routes/admin.ts` 中实现 PUT /api/v1/admin/reports/:assetId/assign
  - 支持修改 regionId、year、status
  - _需求: 2_

### 4. 后端 API - 用户侧改造

- [ ] 4.1 改造城市列表 API
  - 修改 `src/routes/catalog.ts` 中的 GET /api/v1/catalog/regions
  - 只返回有至少 1 个 usable 资产的城市
  - 返回 availableYears 数组
  - _需求: 3_

- [ ] 4.2 改造年份列表 API
  - 修改 `src/routes/catalog.ts` 中的 GET /api/v1/catalog/regions/:regionId/years
  - 只返回 usable 资产对应的年份
  - _需求: 3_

- [ ] 4.3 改造任务创建 API
  - 修改 `src/routes/tasks.ts` 中的 POST /api/v1/tasks/compare/region-year
  - 按 (regionId, year) 查询最新 usable 资产
  - 若缺失返回 ASSET_NOT_FOUND_FOR_REGION_YEAR 错误
  - _需求: 3_

### 5. 后端服务改造

- [ ] 5.1 创建资产查询服务
  - 创建 `src/services/AssetQueryService.ts`
  - 实现"获取城市的 usable 年份"逻辑
  - 实现"获取 (regionId, year) 的最新 usable 资产"逻辑
  - _需求: 1, 3_

- [ ] 5.2 改造资产上传服务
  - 修改 `src/services/FileUploadService.ts`
  - 上传时必须指定 regionId 和 year
  - 上传成功后自动标记为 usable（或 parse_failed）
  - _需求: 2_

### 6. 前端 - 创建任务页面改造

- [ ] 6.1 改造城市选择逻辑
  - 修改 `frontend/src/components/CreateTask.js`
  - 调用 GET /api/v1/catalog/regions 获取城市列表
  - 只显示有 usable 资产的城市
  - _需求: 4_

- [ ] 6.2 改造年份选择逻辑
  - 选择城市后加载年份
  - 年份少于 2 个时禁用"创建任务"按钮
  - 显示提示信息
  - _需求: 4_

- [ ] 6.3 移除任务列表显示
  - 删除或隐藏"任务列表"组件
  - 任务监控仅在后台提供
  - _需求: 4_

### 7. 后台前端 - 年报汇总页面

- [ ] 7.1 创建年报汇总页面
  - 创建 `frontend/src/pages/AdminReports.js`
  - 创建 `frontend/src/pages/AdminReports.css`
  - 实现表格显示所有年报
  - 实现筛选功能（城市、年份、状态、关键词）
  - 实现分页、排序
  - _需求: 5_

- [ ] 7.2 添加统计卡片
  - 显示总城市数、有资产城市数、总资产数等
  - 调用 GET /api/v1/admin/reports/summary
  - _需求: 5_

- [ ] 7.3 添加资产操作
  - 支持点击资产跳转到城市详情页
  - 支持启用/停用资产
  - 支持删除资产
  - _需求: 5_

### 8. 后台前端 - 城市详情页面

- [ ] 8.1 创建城市详情页面
  - 创建 `frontend/src/pages/AdminCityDetail.js`
  - 创建 `frontend/src/pages/AdminCityDetail.css`
  - 显示城市基本信息
  - 按年份分组显示该城市的所有年报
  - _需求: 5_

- [ ] 8.2 添加上传功能
  - 支持上传新年报（必须选择年份）
  - 支持替换同年旧版本
  - _需求: 5_

- [ ] 8.3 添加资产管理
  - 支持启用/停用资产
  - 支持删除资产
  - 支持查看资产详情
  - _需求: 5_

### 9. 后台前端 - 城市管理页面

- [ ] 9.1 创建城市管理页面
  - 创建 `frontend/src/pages/AdminRegions.js`
  - 创建 `frontend/src/pages/AdminRegions.css`
  - 显示所有城市列表
  - 支持新增、编辑、删除城市
  - _需求: 5_

- [ ] 9.2 添加排序功能
  - 支持调整城市排序
  - 支持启用/停用城市
  - _需求: 5_

### 10. 测试

- [ ] 10.1 编写单元测试
  - 测试城市与年报的关联逻辑
  - 测试状态过滤逻辑
  - 测试年份聚合逻辑
  - `src/services/__tests__/AssetQueryService.test.ts`
  - _需求: 1, 3_

- [ ] 10.2 编写集成测试
  - 测试上传年报 → 前端立刻可见
  - 测试禁用年报 → 前端立刻不可见
  - 测试创建任务 → 正确选择最新资产
  - `src/services/__tests__/integration-city-report.test.ts`
  - _需求: 1, 2, 3_

- [ ] 10.3 验收测试
  - 运行用例 1-5（见需求文档）
  - `scripts/test-city-report-integration.ts`
  - _需求: 所有_

### 11. 文档和部署

- [ ] 11.1 更新 API 文档
  - 更新 `API.md`
  - 添加新 API 端点说明
  - _需求: 2, 3_

- [ ] 11.2 更新 README
  - 说明城市与年报的关系
  - 说明如何上传年报
  - _需求: 所有_

- [ ] 11.3 编译和验证
  - 运行 `npm run build`
  - 确保没有编译错误
  - _需求: 所有_

- [ ] 11.4 最终验收
  - 运行所有测试
  - 验证所有用例
  - 确认系统就绪
  - _需求: 所有_

---

## 优先级

### P0（必须做）
- 1.1 - 1.4: 数据模型改造
- 2.1 - 2.2: 城市管理 API
- 3.1 - 3.4: 年报汇总 API
- 4.1 - 4.3: 用户侧 API 改造
- 5.1 - 5.2: 后端服务改造
- 6.1 - 6.3: 前端创建任务页面改造
- 10.3: 验收测试

### P1（应该做）
- 7.1 - 7.3: 后台年报汇总页面
- 8.1 - 8.3: 后台城市详情页面
- 9.1 - 9.2: 后台城市管理页面
- 10.1 - 10.2: 单元和集成测试

### P2（可以做）
- 11.1 - 11.4: 文档和部署

---

## 估时

| 任务 | 估时 | 备注 |
|------|------|------|
| 1. 数据模型改造 | 4h | 包括迁移脚本 |
| 2. 后端 API - 城市管理 | 3h | |
| 3. 后端 API - 年报汇总 | 4h | |
| 4. 后端 API - 用户侧改造 | 2h | |
| 5. 后端服务改造 | 3h | |
| 6. 前端创建任务页面改造 | 2h | |
| 7. 后台年报汇总页面 | 4h | |
| 8. 后台城市详情页面 | 3h | |
| 9. 后台城市管理页面 | 2h | |
| 10. 测试 | 4h | |
| 11. 文档和部署 | 2h | |
| **总计** | **33h** | 约 1 周 |

---

**计划开始日期**: 待定  
**计划完成日期**: 待定  
**状态**: 待执行
