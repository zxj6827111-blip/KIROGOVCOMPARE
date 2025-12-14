# 第二阶段快速启动指南

## 🚀 快速开始

第二阶段已完成核心功能实现。本指南将帮助你快速验证和测试新功能。

---

## 📋 功能清单

### ✅ 已实现的功能

1. **解析数据自动保存**
   - PDF 解析完成后自动保存到文件系统
   - 存储路径：`/uploads/parsed/{assetId}.json`
   - 支持快速读取和缓存

2. **API 端点改进**
   - `GET /api/v1/assets/{assetId}/parse` - 获取解析数据
   - 返回完整的结构化文档
   - 支持错误处理和降级显示

3. **前端详情页面改进**
   - 动态渲染六大板块内容
   - 支持表格渲染
   - 支持文本内容显示
   - 支持降级显示

4. **数据存储服务**
   - 保存解析数据
   - 读取解析数据
   - 删除解析数据
   - 获取存储统计信息

---

## 🧪 测试步骤

### 步骤 1: 启动后端服务

```bash
# 安装依赖
npm install

# 启动后端服务
npm run dev
```

后端服务将在 `http://localhost:3000` 启动。

### 步骤 2: 启动前端服务

```bash
# 在新的终端窗口中
cd frontend
npm install
npm start
```

前端服务将在 `http://localhost:3001` 启动。

### 步骤 3: 访问管理后台

打开浏览器，访问：
```
http://localhost:3000/admin
```

### 步骤 4: 上传 PDF 文件

1. 点击 "📊 年报汇总" 菜单
2. 点击 "⬆️ 上传年报" 按钮
3. 选择地区、年份和 PDF 文件
4. 点击 "💾 上传" 按钮

### 步骤 5: 查看详情页面

1. 在年报列表中找到刚上传的文件
2. 点击 "👁️ 查看" 按钮
3. 查看年报详情页面

**预期结果**：
- ✅ 显示基本信息（文件名、年份、地区等）
- ✅ 显示六大板块内容
- ✅ 表格能够正确渲染
- ✅ 文本内容能够正确显示

---

## 🔍 验证解析数据

### 方法 1: 检查文件系统

```bash
# 查看已保存的解析数据
ls -la uploads/parsed/

# 查看特定资产的解析数据
cat uploads/parsed/{assetId}.json | jq .
```

### 方法 2: 调用 API

```bash
# 获取解析数据
curl http://localhost:3000/api/v1/assets/{assetId}/parse

# 格式化输出
curl http://localhost:3000/api/v1/assets/{assetId}/parse | jq .
```

### 方法 3: 浏览器开发者工具

1. 打开浏览器开发者工具（F12）
2. 切换到 "Network" 标签
3. 查看详情页面
4. 找到 `/api/v1/assets/{assetId}/parse` 请求
5. 查看响应数据

---

## 📊 数据结构

### 解析数据格式

```json
{
  "documentId": "doc_asset_123",
  "assetId": "asset_123",
  "title": "政府信息公开年度报告",
  "sections": [
    {
      "id": "section_1",
      "level": 1,
      "title": "一、总体情况",
      "content": [
        {
          "id": "para_0",
          "text": "段落内容...",
          "type": "normal"
        }
      ],
      "tables": [
        {
          "id": "table_1",
          "title": "表格标题",
          "rows": [
            {
              "rowIndex": 0,
              "rowKey": "row_key",
              "rowLabel": "行标签",
              "cells": [
                {
                  "rowIndex": 0,
                  "colIndex": 0,
                  "colKey": "col_key",
                  "colName": "列名",
                  "value": "单元格值"
                }
              ]
            }
          ],
          "columns": 5,
          "degraded": false
        }
      ],
      "subsections": []
    }
  ],
  "metadata": {
    "totalPages": 10,
    "extractedAt": "2024-12-14T10:00:00.000Z",
    "parseVersion": "2.0"
  }
}
```

---

## 🐛 常见问题

### Q1: 上传 PDF 后没有看到解析数据？

**A**: 
1. 检查后端日志是否有错误
2. 确认 `/uploads/parsed/` 目录是否存在
3. 检查文件系统权限
4. 尝试刷新页面

### Q2: 表格显示不正确？

**A**:
1. 检查 PDF 文件格式是否正确
2. 查看浏览器控制台是否有错误
3. 检查解析数据中表格结构是否完整
4. 尝试使用其他 PDF 文件

### Q3: API 返回 404 错误？

**A**:
1. 确认资产 ID 是否正确
2. 检查解析数据是否已保存
3. 查看后端日志获取更多信息
4. 尝试重新上传 PDF 文件

### Q4: 前端显示"暂无解析数据"？

**A**:
1. 检查 API 是否返回数据
2. 确认解析数据格式是否正确
3. 查看浏览器控制台是否有错误
4. 检查网络请求是否成功

---

## 📈 性能指标

### 预期性能

| 指标 | 目标 | 实际 |
|------|------|------|
| PDF 解析时间 | < 5s | - |
| 数据保存时间 | < 1s | - |
| 数据读取时间 | < 100ms | - |
| API 响应时间 | < 500ms | - |
| 前端渲染时间 | < 1s | - |

---

## 🔧 调试技巧

### 启用详细日志

编辑 `src/services/PdfParseService.ts`，添加更多 `console.log` 语句。

### 检查存储服务

```typescript
import ParsedDataStorageService from './ParsedDataStorageService';

// 获取存储统计信息
const stats = await ParsedDataStorageService.getStorageStats();
console.log('存储统计:', stats);

// 检查特定资产的数据
const data = await ParsedDataStorageService.loadParseData('asset_id');
console.log('解析数据:', data);
```

### 查看 API 响应

```bash
# 获取资产列表
curl http://localhost:3000/api/v1/assets

# 获取特定资产信息
curl http://localhost:3000/api/v1/assets/{assetId}

# 获取解析数据
curl http://localhost:3000/api/v1/assets/{assetId}/parse
```

---

## 📝 下一步

### 今天（第 1 天）

- ✅ 核心功能实现
- ⏳ 运行测试脚本验证

### 明天（第 2 天）

- [ ] 添加单元测试
- [ ] 添加集成测试
- [ ] 性能优化

### 后天（第 3 天）

- [ ] 添加前端测试
- [ ] 完整系统测试
- [ ] 文档完善

---

## 📞 获取帮助

如有任何问题，请：

1. 查看 `PHASE2_IMPLEMENTATION_PLAN.md` - 详细的实现计划
2. 查看 `PHASE2_PROGRESS_REPORT.md` - 进度报告
3. 查看相关的代码文件和注释
4. 运行测试脚本：`npm run test:phase2`

---

**版本**：1.0

**最后更新**：2024-12-14

**状态**：🚀 进行中

