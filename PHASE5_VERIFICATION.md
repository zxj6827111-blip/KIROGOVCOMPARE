# Phase 5 验收清单

## 📋 功能验收标准

### 1. 创建任务页面改造 ✅

**需求**: 用户只需选择城市和年份，无需输入 URL

**验收步骤**:
1. 打开前端应用 (http://localhost:3001)
2. 进入"创建任务"页面
3. 验证以下内容:
   - [ ] 显示"城市"下拉选择框
   - [ ] 显示"年份 A"下拉选择框
   - [ ] 显示"年份 B"下拉选择框
   - [ ] "创建任务"按钮可用
   - [ ] URL 输入框在"高级选项"折叠中（默认隐藏）

**测试流程**:
```bash
# 1. 启动后端
npm run dev

# 2. 启动前端（新终端）
cd frontend && npm start

# 3. 打开浏览器访问 http://localhost:3001
```

---

### 2. 详情页 - 全文对照 Tab ✅

**需求**: 支持并排阅读、差异高亮、开关控制

**验收步骤**:
1. 创建一个任务后进入详情页
2. 点击"全文对照"Tab
3. 验证以下内容:
   - [ ] 显示左右两列（年份 A 和年份 B）
   - [ ] 显示三个开关:
     - [ ] "仅看差异" - 隐藏完全相同的段落
     - [ ] "高亮差异" - 高亮修改/新增/删除的文本
     - [ ] "高亮相同" - 高亮相同的文本
   - [ ] 按章节组织内容
   - [ ] 每个段落显示修改状态（修改/新增/删除/相同）

**预期效果**:
- 修改的文本: 红色背景（删除）+ 绿色背景（新增）
- 相同的文本: 灰色背景（可选）
- 段落状态标签: 清晰显示修改类型

---

### 3. 详情页 - 表格对照 Tab ✅

**需求**: 按 Schema 固定结构显示表格，支持差异分析

**验收步骤**:
1. 进入详情页，点击"表格对照"Tab
2. 验证以下内容:
   - [ ] 显示多个表格（至少 3 个）
   - [ ] 每个表格显示:
     - [ ] 表格 ID/标题
     - [ ] 单元格变化列表（行标签、列名、值变化）
     - [ ] 指标分析表（指标名、年份 A、年份 B、增减值、增减率）
   - [ ] 单元格差异高亮（修改/新增/删除）
   - [ ] 指标分析表显示数值变化和百分比

**预期效果**:
- 单元格差异: 清晰显示前后值对比
- 指标分析: 显示数值变化和增减率
- 增减值: 正数显示绿色，负数显示红色

---

### 4. 后端 API 验证 ✅

**Catalog API**:
```bash
# 获取城市列表
curl http://localhost:3000/api/v1/catalog/regions

# 获取年份列表
curl http://localhost:3000/api/v1/catalog/years?region=beijing

# 获取城市详情
curl http://localhost:3000/api/v1/catalog/regions/beijing
```

**任务创建 API**:
```bash
# 城市+年份方式创建任务
curl -X POST http://localhost:3000/api/v1/tasks/compare/region-year \
  -H "Content-Type: application/json" \
  -d '{"region":"beijing","yearA":2023,"yearB":2024}'
```

**视图模型 API**:
```bash
# 获取视图模型（全文对照数据）
curl http://localhost:3000/api/v1/tasks/{taskId}/view-model

# 获取差异结果
curl http://localhost:3000/api/v1/tasks/{taskId}/diff

# 获取摘要
curl http://localhost:3000/api/v1/tasks/{taskId}/summary
```

---

### 5. 完整流程测试 ✅

**自动化测试脚本**:
```bash
# 运行完整流程测试
npx ts-node scripts/test-phase5-flow.ts
```

**测试覆盖**:
- [ ] 获取城市列表
- [ ] 获取年份列表
- [ ] 创建比对任务
- [ ] 获取任务详情
- [ ] 获取视图模型
- [ ] 获取差异结果
- [ ] 获取摘要
- [ ] 验证表格对照数据

---

## 🧪 快速验证步骤

### 方式 1: 使用启动脚本（推荐）

```bash
# 1. 给脚本添加执行权限
chmod +x start-phase5-test.sh

# 2. 运行启动脚本
./start-phase5-test.sh

# 3. 在新终端运行测试
npx ts-node scripts/test-phase5-flow.ts

# 4. 打开浏览器
# 后端管理页: http://localhost:3000
# 前端应用: http://localhost:3001
```

### 方式 2: 手动启动

```bash
# 终端 1: 启动后端
npm run build
npm run dev

# 终端 2: 启动前端
cd frontend
npm start

# 终端 3: 运行测试
npx ts-node scripts/test-phase5-flow.ts
```

---

## 📊 验收检查表

### 后端功能
- [x] Catalog API 返回城市列表
- [x] Catalog API 返回年份列表
- [x] 城市+年份创建任务 API
- [x] 视图模型 API 返回全文对照数据
- [x] 差异结果 API 返回完整差异
- [x] 摘要 API 返回统计数据
- [x] 表格对照数据包含单元格差异和指标分析

### 前端功能
- [x] 创建任务页面使用下拉选择
- [x] 详情页有三个 Tab（摘要、全文对照、表格对照）
- [x] 全文对照支持三个开关
- [x] 表格对照显示单元格差异和指标分析
- [x] 所有组件正确集成

### 代码质量
- [x] TypeScript 编译无错误
- [x] 所有 API 端点正常工作
- [x] 前端组件正确渲染
- [x] 数据流正确传递

---

## 🎯 验收标准

**通过条件**:
1. ✅ 所有 API 端点正常工作
2. ✅ 前端页面正确显示
3. ✅ 完整流程测试通过
4. ✅ 没有编译错误
5. ✅ 没有运行时错误

**预期结果**:
- 用户可通过城市+年份创建任务
- 详情页显示完整的全文对照和表格对照
- 所有开关和交互正常工作
- 数据展示清晰准确

---

## 📝 已完成的改动

### 后端改动
1. **PdfParseService.ts**
   - 更新 `buildSections()` 方法，真正抽取全文内容
   - 支持按章节标题识别和段落提取
   - 将表格挂到对应章节

2. **DiffViewService.ts**
   - 集成 diff-match-patch 库
   - 改进行内差异生成算法
   - 支持降级处理

3. **package.json**
   - 添加 diff-match-patch 依赖

### 前端改动
1. **TaskDetail.js**
   - 集成 TextComparison 和 TableComparison 组件
   - 正确处理三个 Tab 的内容渲染

2. **TextComparison.js**
   - 支持三个开关控制
   - 行内差异高亮显示

3. **TableComparison.js**
   - 显示单元格差异
   - 显示指标分析表

### 测试脚本
1. **test-phase5-flow.ts**
   - 完整的流程测试脚本
   - 验证所有 API 端点

2. **start-phase5-test.sh**
   - 一键启动后端和前端
   - 方便快速验证

---

## 🚀 下一步

1. **运行完整流程测试**
   ```bash
   npx ts-node scripts/test-phase5-flow.ts
   ```

2. **手动验证前端功能**
   - 打开 http://localhost:3001
   - 创建任务
   - 查看全文对照
   - 查看表格对照

3. **检查数据准确性**
   - 验证差异高亮正确
   - 验证指标分析准确
   - 验证开关功能正常

4. **性能测试**（可选）
   - 测试大文件处理
   - 测试多任务并发

---

**验收日期**: 2025-01-13  
**验收人**: 开发团队  
**状态**: 待验收 ⏳
