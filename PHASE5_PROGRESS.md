# 第五阶段进度 - 系统改造

**状态**: 进行中  
**完成度**: 60%  
**最后更新**: 2025-01-13

## ✅ 已完成

### 后端改造
- [x] 新增 Catalog API (`src/routes/catalog.ts`)
  - [x] GET /api/v1/catalog/regions - 获取城市列表
  - [x] GET /api/v1/catalog/years - 获取年份列表
  - [x] GET /api/v1/catalog/regions/:region - 获取城市详情
  
- [x] 新增任务创建 API
  - [x] POST /api/v1/tasks/compare/region-year - 按城市+年份创建任务
  - [x] 保留 POST /api/v1/tasks/compare/url - 兼容旧 API

### 前端改造
- [x] 改造创建任务页面
  - [x] 改为下拉选择城市
  - [x] 改为下拉选择年份 A 和年份 B
  - [x] 隐藏 URL 入口（折叠高级选项）
  - [x] 调用新 API 创建任务

## ⏳ 进行中

### 后端改造（进行中）
- [x] PDF 解析增强
  - [x] 真正抽取全文内容（buildSections 方法已更新）
  - [x] 按 Schema 固定输出 6 张表格
  - [x] 生成完整的 StructuredDocument

- [x] Diff 视图模型
  - [x] 新增 DiffViewService
  - [x] 支持全文对照数据结构
  - [x] 新增 API: GET /api/v1/tasks/:taskId/view-model
  - [x] 集成 diff-match-patch 库用于精确行内差异

### 前端改造（已完成）
- [x] 详情页改造
  - [x] 新增全文对照 Tab
  - [x] 新增表格对照 Tab
  - [x] 支持差异开关（仅看差异、高亮差异、高亮相同）

## 📊 当前 API 端点

### 目录 API
```
GET /api/v1/catalog/regions
  返回城市列表

GET /api/v1/catalog/years?region=beijing
  返回指定城市的年份列表

GET /api/v1/catalog/regions/beijing
  返回城市详情
```

### 任务创建 API
```
POST /api/v1/tasks/compare/region-year
  入参: { region, yearA, yearB }
  返回: { taskId, status, message, ... }

POST /api/v1/tasks/compare/url
  入参: { urlA, urlB }
  返回: { taskId, status, message, ... }
```

## 🧪 测试方法

### 1. 获取城市列表
```bash
curl http://localhost:3000/api/v1/catalog/regions
```

### 2. 获取年份列表
```bash
curl http://localhost:3000/api/v1/catalog/years?region=beijing
```

### 3. 创建任务（城市+年份方式）
```bash
curl -X POST http://localhost:3000/api/v1/tasks/compare/region-year \
  -H "Content-Type: application/json" \
  -d '{"region":"beijing","yearA":2023,"yearB":2024}'
```

## 📝 下一步计划

### 优先级 P0（必须做）
- [x] PDF 解析增强 - 真正抽取全文内容 ✅
- [x] Diff 视图模型 - 支持全文对照 ✅
- [x] 前端详情页改造 - 新增全文对照和表格对照 Tab ✅
- [ ] 测试验证 - 运行完整流程测试
- [ ] 数据库迁移 - 创建城市-年份索引表（可选）
- [ ] 数据种子 - 从 fixtures 导入样例数据（可选）

### 优先级 P1（应该做）
1. 管理后台增强 - 显示资源管理模块
2. 性能优化 - 缓存城市和年份列表
3. 错误处理 - 完善异常处理

### 优先级 P2（可以做）
1. 日志记录 - 添加详细日志
2. 单元测试 - 补充测试用例
3. 文档更新 - 更新 README

## 🎯 验收标准

- [ ] 用户可通过城市+年份创建任务
- [ ] 详情页显示全文对照（并排、可切换开关）
- [ ] 详情页显示表格对照（按 Schema、差异高亮）
- [ ] 管理后台显示城市/年份资源
- [ ] 用 fixtures 数据一键创建任务并查看对照

## 📚 相关文件

- 需求文档: `PHASE5_REQUIREMENTS.md`
- 后端 Catalog API: `src/routes/catalog.ts`
- 前端创建任务页: `frontend/src/components/CreateTask.js`
- Mock API: `src/index-mock.ts`

## 💡 技术笔记

### 城市-年份索引
当前使用模拟数据，支持的城市：
- beijing (北京市) - 2022, 2023, 2024
- shanghai (上海市) - 2023, 2024
- guangzhou (广州市) - 2023, 2024
- shenzhen (深圳市) - 2024
- chengdu (成都市) - 2023, 2024
- hangzhou (杭州市) - 2023, 2024

### 前端改造
- 创建任务页已改为下拉选择
- 高级选项（URL 方式）已折叠隐藏
- 自动加载城市和年份列表

---

**下一步**: 开始 PDF 解析增强和 Diff 视图模型开发
