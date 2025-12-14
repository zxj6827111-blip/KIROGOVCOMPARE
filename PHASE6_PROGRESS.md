# Phase 6 进度 - 城市-年报资产一体化改造

**状态**: 进行中  
**完成度**: 40% (P0 任务完成)  
**最后更新**: 2025-12-13

---

## ✅ 已完成

### 数据模型改造
- [x] 1.1 创建 Region 模型 (`src/models/Region.ts`)
  - 定义 Region 接口和 RegionModel 类
  - 支持城市的创建和更新

- [x] 1.2 改造 ReportAsset 模型
  - 现有模型已支持 region 字段
  - 支持 status 字段（usable/disabled/unassigned/parse_failed）

### 后端服务
- [x] 2.1 创建 RegionService (`src/services/RegionService.ts`)
  - 实现城市 CRUD 操作
  - 支持分页查询
  - 初始化 6 个默认城市

- [x] 2.2 创建 AssetQueryService (`src/services/AssetQueryService.ts`)
  - 关键规则：只返回 status=usable 的资产
  - 获取城市的可用年份
  - 获取 (regionId, year) 的最新 usable 资产
  - 获取有 usable 资产的城市列表
  - 支持多维度筛选和分页

### 后端 API
- [x] 3.1 创建后台管理 API (`src/routes/admin.ts`)
  - GET /api/v1/admin/regions - 获取城市列表
  - POST /api/v1/admin/regions - 创建城市
  - PUT /api/v1/admin/regions/:regionId - 编辑城市
  - DELETE /api/v1/admin/regions/:regionId - 删除城市
  - GET /api/v1/admin/reports - 获取年报列表（支持筛选）
  - GET /api/v1/admin/reports/summary - 获取统计数据
  - POST /api/v1/admin/assets/upload - 上传年报
  - PUT /api/v1/admin/reports/:assetId/assign - 重新归属资产

- [x] 3.2 改造用户侧 API (`src/routes/catalog.ts`)
  - GET /api/v1/catalog/regions - 只返回有 usable 资产的城市
  - GET /api/v1/catalog/regions/:regionId/years - 返回城市的可用年份
  - GET /api/v1/catalog/regions/:regionId - 获取城市详情

### 集成
- [x] 4.1 在 Mock API 中注册 admin 路由
  - 在 `src/index-mock.ts` 中导入并注册 admin 路由

### 测试
- [x] 5.1 创建完整流程测试脚本 (`scripts/test-city-report-integration.ts`)
  - ✅ 用例 1: 新建城市无资产 - 通过
  - ✅ 用例 2: 上传单年份年报 - 通过
  - ✅ 用例 3: 上传多年份年报 - 通过
  - ✅ 用例 4: 年报汇总筛选 - 通过
  - ✅ 用例 5: 资产状态控制 - 通过

---

## ⏳ 待完成

### 前端改造（P1）
- [ ] 6.1 改造创建任务页面
  - 调用 GET /api/v1/catalog/regions 获取城市列表
  - 只显示有 usable 资产的城市
  - 年份不足 2 个时禁用"创建任务"按钮

- [ ] 6.2 移除任务列表显示
  - 删除或隐藏"任务列表"组件

### 后台前端页面（P1）
- [ ] 7.1 创建年报汇总页面
  - 表格显示所有年报
  - 支持筛选、分页、排序
  - 显示统计卡片

- [ ] 7.2 创建城市详情页面
  - 显示城市基本信息
  - 按年份分组显示年报
  - 支持上传、启用/停用、删除

- [ ] 7.3 创建城市管理页面
  - 显示所有城市列表
  - 支持新增、编辑、删除城市

### 数据库迁移（P2）
- [ ] 8.1 创建数据库迁移脚本
  - 创建 regions 表
  - 修改 report_assets 表添加 region_id 外键

- [ ] 8.2 数据迁移脚本
  - 扫描现有资产，推断 regionId
  - 标记无法推断的为 unassigned

---

## 📊 API 端点总结

### 后台管理 API
```
GET    /api/v1/admin/regions                    - 获取城市列表
POST   /api/v1/admin/regions                    - 创建城市
PUT    /api/v1/admin/regions/:regionId          - 编辑城市
DELETE /api/v1/admin/regions/:regionId          - 删除城市
GET    /api/v1/admin/reports                    - 获取年报列表
GET    /api/v1/admin/reports/summary            - 获取统计数据
POST   /api/v1/admin/assets/upload              - 上传年报
PUT    /api/v1/admin/reports/:assetId/assign    - 重新归属资产
```

### 用户侧 API
```
GET    /api/v1/catalog/regions                  - 获取有数据的城市列表
GET    /api/v1/catalog/regions/:regionId/years  - 获取城市的年份列表
GET    /api/v1/catalog/regions/:regionId        - 获取城市详情
```

---

## 🎯 关键实现细节

### 1. 数据驱动的城市展示
- 后台可见所有城市（包括无资产的）
- 用户侧只显示有至少 1 个 usable 资产的城市
- 上传年报后立刻出现在用户侧

### 2. 资产状态控制
- 只有 status=usable 的资产才会出现在用户侧
- 解析失败的资产标记为 parse_failed，不会污染前端下拉

### 3. 年份聚合
- 自动聚合城市的所有 usable 资产年份
- 支持多年份对比（年份不足 2 个时禁用创建任务按钮）

### 4. 多维度筛选
- 后台年报汇总支持按城市、年份、状态、关键词筛选
- 支持分页和排序（默认按 uploadedAt 降序）

---

## 📈 测试结果

所有 5 个验收用例均已通过：

```
✅ 用例 1: 新建城市无资产 - 通过
✅ 用例 2: 上传单年份年报 - 通过
✅ 用例 3: 上传多年份年报 - 通过
✅ 用例 4: 年报汇总筛选 - 通过
✅ 用例 5: 资产状态控制 - 通过
```

---

## 🚀 下一步

### 立即可做
1. 改造前端创建任务页面（调用新 API）
2. 创建后台年报汇总页面
3. 创建后台城市详情页面

### 后续
1. 数据库迁移和数据初始化
2. 前端集成测试
3. 端到端测试

---

**编译状态**: ✅ 通过 (0 errors)  
**测试状态**: ✅ 全部通过  
**系统状态**: ✅ 运行中 (http://localhost:3000)
