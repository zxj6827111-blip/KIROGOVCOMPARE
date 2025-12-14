# Phase 6 需求文档 - 城市-年报资产一体化改造

## 介绍

当前系统存在前后端数据割裂问题：后端管理年报资产，但与城市关系不清晰；前端创建任务时无法准确判断哪些城市有可用数据。本阶段通过强化城市与年报资产的绑定关系，实现"数据驱动的城市展示"，确保前端只展示有实际年报数据的城市。

## 术语表

- **Region（城市）**: 行政区划单位，主数据表 regions
- **Report Asset（年报资产）**: 上传的 PDF 文件及其元数据，存储在 report_assets
- **Usable（可用）**: 资产状态为 usable，表示已解析成功且可用于任务创建
- **Region-Year 组合**: 某城市某年份的年报，唯一标识为 (region_id, year)

---

## 需求

### 需求 1: 数据模型改造

**用户故事**: 作为系统管理员，我需要清晰的城市与年报资产关系，以便管理和追踪数据完整性。

#### 接受标准

1. WHEN 创建年报资产时，THE 系统 SHALL 要求指定所属城市（region_id）
   - 每个资产必须有 region_id 外键指向 regions 表
   - 不允许 region_id 为空

2. WHEN 查询某城市的年报时，THE 系统 SHALL 只返回 status=usable 的资产
   - 状态包括：usable、disabled、unassigned、parse_failed
   - 前端展示逻辑必须基于 status=usable，不能只看文件是否存在

3. WHEN 前端请求城市列表时，THE 系统 SHALL 只返回至少拥有 1 个 usable 年报资产的城市
   - 即使 regions 表中存在该城市，但无 usable 资产则不返回
   - 返回结果中包含 availableYears 数组

4. WHEN 上传年报资产时，THE 系统 SHALL 自动将其关联到指定城市
   - 上传接口必须接收 regionId 和 year 参数
   - 保存成功后，该城市立刻出现在用户侧城市列表中

---

### 需求 2: 后台管理 API

**用户故事**: 作为后台管理员，我需要统一的界面管理城市和年报资产，包括查看、上传、启用/停用等操作。

#### 接受标准

1. WHEN 访问城市管理页面时，THE 系统 SHALL 提供 GET /api/v1/admin/regions 接口
   - 返回所有城市列表（包括无资产的城市）
   - 字段：regionId, name, status, createdAt, updatedAt
   - 支持分页、排序

2. WHEN 新增或编辑城市时，THE 系统 SHALL 提供 POST/PUT /api/v1/admin/regions 接口
   - 支持启用/停用城市
   - 支持调整城市排序

3. WHEN 访问年报汇总页面时，THE 系统 SHALL 提供 GET /api/v1/admin/reports 接口
   - 返回所有年报资产列表
   - 字段：assetId, regionId, regionName, year, sourceType, status, uploadedAt, fileName, parseVersion
   - 支持按城市、年份、状态、关键词筛选
   - 支持分页排序（默认 uploadedAt desc）

4. WHEN 查看年报统计时，THE 系统 SHALL 提供 GET /api/v1/admin/reports/summary 接口
   - 返回聚合统计数据
   - 包括：总城市数、有资产城市数、总资产数、按城市分组的年份数等

5. WHEN 上传年报资产时，THE 系统 SHALL 提供 POST /api/v1/admin/assets/upload 接口
   - 必须指定 regionId 和 year
   - 支持替换同年旧版本（标记旧版本为 disabled）
   - 返回 assetId 和初始状态

6. WHEN 需要重新归属资产时，THE 系统 SHALL 提供 PUT /api/v1/admin/reports/:assetId/assign 接口
   - 支持修改资产的 regionId 和 year
   - 支持修改资产状态（usable/disabled/unassigned）

---

### 需求 3: 用户侧 API（城市/年份目录）

**用户故事**: 作为普通用户，我需要看到有实际年报数据的城市，并能选择年份创建对比任务。

#### 接受标准

1. WHEN 打开创建任务页面时，THE 系统 SHALL 调用 GET /api/v1/catalog/regions
   - 只返回至少拥有 1 个 usable 年报资产的城市
   - 返回字段：regionId, name, availableYears[]
   - availableYears 基于该城市所有 usable 资产的年份去重

2. WHEN 选择城市后，THE 系统 SHALL 调用 GET /api/v1/catalog/regions/:regionId/years
   - 返回该城市的可用年份列表
   - 只包含 usable 资产对应的年份

3. WHEN 创建任务时，THE 系统 SHALL 调用 POST /api/v1/tasks/compare/region-year
   - 入参：{ regionId, yearA, yearB }
   - 后端按 (regionId, year) 选择最新的 usable 资产
   - 若某年份缺失 usable 资产，返回结构化错误 ASSET_NOT_FOUND_FOR_REGION_YEAR

---

### 需求 4: 用户侧前端改造

**用户故事**: 作为普通用户，我需要一个简洁的创建任务流程，只看到有数据的城市。

#### 接受标准

1. WHEN 打开创建任务页面时，THE 前端 SHALL 只显示有 usable 年报资产的城市
   - 调用 GET /api/v1/catalog/regions 获取城市列表
   - 不显示无资产的城市

2. WHEN 城市可用年份少于 2 个时，THE 前端 SHALL 禁用"创建任务"按钮
   - 显示提示："该城市年报年份不足，无法对比"
   - 允许用户看到城市，但无法创建任务

3. WHEN 用户成功创建任务时，THE 前端 SHALL 跳转到任务详情页
   - 显示全文对照和表格对照

4. WHEN 前端加载时，THE 前端 SHALL 不显示"任务列表"或"最近任务"
   - 任务监控功能仅在后台管理页面提供

---

### 需求 5: 后台前端页面

**用户故事**: 作为后台管理员，我需要两个核心页面来管理城市和年报资产。

#### 接受标准

1. WHEN 访问城市详情页时，THE 后台 SHALL 显示该城市的所有年报
   - 按年份分组显示
   - 支持上传新年报（必须选择年份）
   - 支持启用/停用某份资产
   - 支持删除资产

2. WHEN 访问年报汇总页时，THE 后台 SHALL 显示所有年报的统计表格
   - 支持按城市、年份、状态、关键词筛选
   - 支持分页、排序
   - 支持点击资产跳转到城市详情页或资产预览

3. WHEN 页面加载时，THE 后台 SHALL 显示统计卡片
   - 总城市数、有资产城市数、总资产数等

---

## 验收用例

### 用例 1: 新建城市无资产

**场景**: 后台新建城市 X，但不上传任何年报

**预期结果**:
- ✅ 城市 X 在后台城市列表中可见
- ✅ 用户侧创建任务页面不显示城市 X
- ✅ 调用 GET /api/v1/catalog/regions 不返回城市 X

### 用例 2: 上传单年份年报

**场景**: 后台给城市 X 上传 2024 年年报并标记 usable

**预期结果**:
- ✅ 用户侧出现城市 X
- ✅ availableYears = [2024]
- ✅ "创建任务"按钮禁用，提示"年份不足"

### 用例 3: 上传多年份年报

**场景**: 再上传 2023 年年报

**预期结果**:
- ✅ availableYears = [2023, 2024]
- ✅ "创建任务"按钮启用
- ✅ 用户可选 2023 vs 2024 并成功创建任务

### 用例 4: 年报汇总筛选

**场景**: 后台年报汇总页按年份=2024 筛选

**预期结果**:
- ✅ 只显示 2024 年的所有年报
- ✅ 支持进一步按城市过滤
- ✅ 显示每条资产的城市名、状态、上传时间等

### 用例 5: 资产状态控制

**场景**: 上传了一份解析失败的年报，状态为 parse_failed

**预期结果**:
- ✅ 该资产不出现在用户侧年份列表中
- ✅ 后台可见该资产，状态显示为 parse_failed
- ✅ 后台可手动修改状态为 usable 或 disabled

---

## 关键规则

1. **前端展示逻辑必须基于 status=usable**
   - 不能只看文件是否存在
   - 不能只看 region_id 是否有值
   - 必须检查 status 字段

2. **城市与年报的强绑定**
   - 每个年报必须有 region_id
   - 不允许 unassigned 状态的资产出现在用户侧

3. **上传时自动关联**
   - 上传接口必须接收 regionId 和 year
   - 保存成功后立刻可在用户侧看到

4. **分页和排序**
   - 后台列表必须支持分页（默认 pageSize=20）
   - 默认按 uploadedAt desc 排序

---

## 相关文件

- 数据模型: `src/models/ReportAsset.ts`, `src/models/Region.ts`
- 后台 API: `src/routes/admin.ts` (新增)
- 用户 API: `src/routes/catalog.ts` (改造)
- 前端: `frontend/src/components/CreateTask.js` (改造)
- 后台前端: `frontend/src/pages/AdminReports.js` (新增)

---

**完成日期**: 待定  
**优先级**: P0 - 核心功能  
**状态**: 待设计
