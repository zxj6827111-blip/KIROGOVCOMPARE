# 后端管理页面指南

## 📋 概述

后端管理页面是一个内置的 Web 界面，用于实时监控和管理比对任务。无需额外的前端应用，直接访问后端服务即可使用。

## 🚀 访问方式

### 后端管理页面
```
http://localhost:3000
```

### API 端点
```
http://localhost:3000/api/v1
```

## 🎨 功能介绍

### 1. 系统状态监控
在页面顶部显示实时统计数据：
- **总任务数** - 所有任务的总数
- **已完成** - 状态为 completed 的任务数
- **处理中** - 状态为 processing 的任务数
- **失败** - 状态为 failed 的任务数

### 2. 创建新任务
左侧卡片提供快速创建任务的表单：
- 输入第一份报告的 URL
- 输入第二份报告的 URL
- 点击"创建任务"按钮
- 系统会返回任务 ID 和创建状态

### 3. 最近任务列表
右侧卡片显示最近的 10 个任务：
- 任务 ID
- 资产 A 和资产 B 的 ID
- 创建时间
- 任务状态（用不同颜色标记）

### 4. API 文档
页面下方提供完整的 API 文档：
- 任务相关 API
- 资产相关 API
- 建议相关 API

### 5. 系统信息
显示系统运行状态：
- API 版本
- 服务器当前时间
- 服务器运行时间
- 运行模式（Mock/Production）

## 📊 任务状态说明

| 状态 | 颜色 | 说明 |
|------|------|------|
| queued | 橙色 | 等待处理 |
| processing | 蓝色 | 正在处理 |
| completed | 绿色 | 已完成 |
| failed | 红色 | 处理失败 |

## 🔄 自动刷新

- 任务列表每 5 秒自动刷新一次
- 服务器时间每 1 秒更新一次
- 可以手动点击"刷新"按钮立即刷新

## 💡 使用示例

### 创建一个比对任务

1. 打开 `http://localhost:3000`
2. 在"创建新任务"表单中输入：
   - 第一份报告 URL: `https://example.com/report2023.pdf`
   - 第二份报告 URL: `https://example.com/report2024.pdf`
3. 点击"创建任务"按钮
4. 系统会显示成功消息和任务 ID
5. 任务会立即出现在"最近任务"列表中

### 查看任务详情

1. 在"最近任务"列表中找到要查看的任务
2. 记下任务 ID
3. 访问 API 端点获取详情：
   ```
   http://localhost:3000/api/v1/tasks/{taskId}/diff
   http://localhost:3000/api/v1/tasks/{taskId}/summary
   ```

## 🔌 API 集成

### 获取任务列表
```bash
curl http://localhost:3000/api/v1/tasks
```

### 创建任务
```bash
curl -X POST http://localhost:3000/api/v1/tasks/compare/url \
  -H "Content-Type: application/json" \
  -d '{
    "urlA": "https://example.com/report1.pdf",
    "urlB": "https://example.com/report2.pdf"
  }'
```

### 获取差异结果
```bash
curl http://localhost:3000/api/v1/tasks/{taskId}/diff
```

### 获取摘要
```bash
curl http://localhost:3000/api/v1/tasks/{taskId}/summary
```

## 🎯 工作流程

```
1. 打开后端管理页面
   ↓
2. 查看系统状态和最近任务
   ↓
3. 创建新的比对任务
   ↓
4. 监控任务状态
   ↓
5. 任务完成后查看结果
```

## 📱 响应式设计

后端管理页面支持多种屏幕尺寸：
- 桌面版 (1200px+)
- 平板版 (768px - 1199px)
- 手机版 (< 768px)

## 🔧 技术细节

### 前端技术
- 纯 HTML/CSS/JavaScript
- 无需构建工具
- 无需额外依赖
- 直接在浏览器中运行

### 后端集成
- 静态文件由 Express 提供
- 通过 Fetch API 调用后端 API
- 支持 CORS 跨域请求

## 🚨 常见问题

### Q: 页面无法加载？
A: 确保后端服务运行在 `http://localhost:3000`，检查浏览器控制台的错误信息。

### Q: 创建任务失败？
A: 检查输入的 URL 是否正确，确保后端 API 可以访问。

### Q: 任务列表不更新？
A: 页面会每 5 秒自动刷新，也可以手动点击"刷新"按钮。

### Q: 如何查看完整的差异结果？
A: 在浏览器中访问 `/api/v1/tasks/{taskId}/diff` 端点查看完整的 JSON 数据。

## 📚 相关文档

- [前端设置指南](./FRONTEND_SETUP.md)
- [API 文档](./API.md)
- [快速参考](./QUICK_REFERENCE.md)

## 🎉 总结

后端管理页面提供了一个简洁而强大的界面来管理年报比对系统。无需复杂的配置，直接访问即可使用所有功能。

---

**后端管理页面已准备就绪！** 🚀

访问 `http://localhost:3000` 开始使用。
