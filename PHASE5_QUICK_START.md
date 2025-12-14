# Phase 5 快速启动指南

## 🚀 一键启动

### 前置条件
- Node.js 14+ 已安装
- npm 已安装
- 依赖已安装 (`npm install`)

### 启动步骤

#### 方式 1: 使用启动脚本（推荐）

```bash
# 1. 给脚本添加执行权限
chmod +x start-phase5-test.sh

# 2. 运行启动脚本（会自动启动后端和前端）
./start-phase5-test.sh

# 3. 打开浏览器
# 后端管理页: http://localhost:3000
# 前端应用: http://localhost:3001

# 4. 在新终端运行测试
npx ts-node scripts/test-phase5-flow.ts
```

#### 方式 2: 手动启动

```bash
# 终端 1: 编译并启动后端
npm run build
npm run dev

# 终端 2: 启动前端
cd frontend
npm start

# 终端 3: 运行测试
npx ts-node scripts/test-phase5-flow.ts
```

---

## 📋 功能验证清单

### 1️⃣ 创建任务页面

打开 http://localhost:3001，验证以下内容：

- [ ] 显示"选择城市"下拉框
- [ ] 显示"年份 A"下拉框
- [ ] 显示"年份 B"下拉框
- [ ] 点击"创建任务"按钮
- [ ] URL 输入框在"高级选项"中（默认隐藏）

**测试流程**:
```
1. 选择城市: 北京市
2. 选择年份 A: 2023
3. 选择年份 B: 2024
4. 点击"创建任务"
5. 等待任务创建成功提示
```

### 2️⃣ 详情页 - 全文对照

进入任务详情页，点击"全文对照"Tab：

- [ ] 显示左右两列（年份 A 和年份 B）
- [ ] 显示三个开关：
  - [ ] "仅看差异" - 隐藏相同内容
  - [ ] "高亮差异" - 高亮修改/新增/删除
  - [ ] "高亮相同" - 高亮相同内容
- [ ] 按章节组织内容
- [ ] 差异文本有颜色标记

**测试流程**:
```
1. 打开任务详情
2. 点击"全文对照"Tab
3. 勾选"仅看差异" - 应该隐藏相同段落
4. 勾选"高亮差异" - 应该显示红色（删除）和绿色（新增）
5. 勾选"高亮相同" - 应该显示灰色相同文本
```

### 3️⃣ 详情页 - 表格对照

点击"表格对照"Tab：

- [ ] 显示多个表格
- [ ] 每个表格显示：
  - [ ] 表格标题
  - [ ] 单元格变化列表
  - [ ] 指标分析表
- [ ] 指标分析表显示：
  - [ ] 指标名称
  - [ ] 年份 A 的值
  - [ ] 年份 B 的值
  - [ ] 增减值（绿色正数，红色负数）
  - [ ] 增减率（百分比）

**测试流程**:
```
1. 点击"表格对照"Tab
2. 查看表格列表
3. 查看单元格变化
4. 查看指标分析表
5. 验证数值计算正确
```

### 4️⃣ 后端 API 验证

运行自动化测试脚本：

```bash
npx ts-node scripts/test-phase5-flow.ts
```

**预期输出**:
```
✅ Phase 5 完整流程测试通过！

📋 测试总结:
  ✓ 城市列表 API 正常
  ✓ 年份列表 API 正常
  ✓ 城市+年份创建任务 API 正常
  ✓ 任务详情 API 正常
  ✓ 视图模型（全文对照）API 正常
  ✓ 差异结果 API 正常
  ✓ 摘要 API 正常
  ✓ 表格对照数据完整
```

---

## 🧪 手动 API 测试

### 获取城市列表
```bash
curl http://localhost:3000/api/v1/catalog/regions
```

**预期响应**:
```json
{
  "regions": [
    {
      "regionId": "beijing",
      "name": "北京市",
      "availableYears": 3
    },
    ...
  ]
}
```

### 获取年份列表
```bash
curl http://localhost:3000/api/v1/catalog/years?region=beijing
```

**预期响应**:
```json
{
  "years": [2022, 2023, 2024]
}
```

### 创建任务
```bash
curl -X POST http://localhost:3000/api/v1/tasks/compare/region-year \
  -H "Content-Type: application/json" \
  -d '{"region":"beijing","yearA":2023,"yearB":2024}'
```

**预期响应**:
```json
{
  "taskId": "task_xxx",
  "region": "beijing",
  "yearA": 2023,
  "yearB": 2024,
  "status": "queued",
  "message": "任务已入队，等待处理"
}
```

### 获取视图模型
```bash
curl http://localhost:3000/api/v1/tasks/{taskId}/view-model
```

**预期响应**:
```json
{
  "taskId": "task_xxx",
  "sections": [
    {
      "sectionId": "section_1",
      "sectionTitle": "一、概述",
      "level": 1,
      "blocks": [
        {
          "type": "paragraph",
          "status": "modified",
          "beforeText": "...",
          "afterText": "...",
          "inlineDiff": [...]
        }
      ]
    }
  ]
}
```

---

## 📊 验收标准

✅ **通过条件**:
1. 所有 API 端点正常工作
2. 前端页面正确显示
3. 完整流程测试通过
4. 没有编译错误
5. 没有运行时错误

✅ **预期结果**:
- 用户可通过城市+年份创建任务
- 详情页显示完整的全文对照和表格对照
- 所有开关和交互正常工作
- 数据展示清晰准确

---

## 🐛 常见问题

### Q: 启动后端时出现 "Port 3000 already in use"

**解决方案**:
```bash
# 查找占用 3000 端口的进程
lsof -i :3000

# 杀死进程
kill -9 <PID>

# 或者使用不同的端口
PORT=3001 npm run dev
```

### Q: 前端无法连接到后端

**解决方案**:
1. 确保后端已启动 (http://localhost:3000/health)
2. 检查 CORS 配置
3. 检查浏览器控制台错误信息

### Q: 测试脚本报错 "Cannot find module"

**解决方案**:
```bash
# 重新安装依赖
npm install

# 重新编译
npm run build

# 再次运行测试
npx ts-node scripts/test-phase5-flow.ts
```

### Q: 前端页面显示空白

**解决方案**:
1. 检查浏览器控制台是否有错误
2. 确保前端已正确启动
3. 尝试清除浏览器缓存并刷新

---

## 📝 文件说明

### 新增文件
- `scripts/test-phase5-flow.ts` - 完整流程测试脚本
- `start-phase5-test.sh` - 一键启动脚本
- `PHASE5_VERIFICATION.md` - 详细验收清单
- `PHASE5_QUICK_START.md` - 本文件

### 修改文件
- `src/services/PdfParseService.ts` - 增强全文提取
- `src/services/DiffViewService.ts` - 集成 diff-match-patch
- `frontend/src/components/TaskDetail.js` - 集成新组件
- `frontend/src/components/TextComparison.js` - 全文对照组件
- `frontend/src/components/TableComparison.js` - 表格对照组件
- `package.json` - 添加 diff-match-patch 依赖

---

## 🎯 下一步

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

**最后更新**: 2025-01-13  
**状态**: ✅ 就绪
