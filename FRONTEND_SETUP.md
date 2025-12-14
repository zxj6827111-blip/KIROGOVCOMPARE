# 前端设置指南

## 📋 概述

前端应用已创建完成，使用 React 构建，提供了一个现代化的用户界面用于年报比对。

## 🚀 快速启动

### 方式 1: 分别启动前后端

**启动后端** (已运行):
```bash
# 后端已在运行，监听 http://localhost:3000
```

**启动前端**:
```bash
cd frontend
npm install
npm start
```

前端将在 `http://localhost:3000` 启动（React 开发服务器会自动使用不同的端口）

### 方式 2: 同时启动前后端

```bash
chmod +x start-all.sh
./start-all.sh
```

## 📁 前端项目结构

```
frontend/
├── public/
│   └── index.html              # HTML 入口
├── src/
│   ├── components/
│   │   ├── TaskList.js         # 任务列表组件
│   │   ├── TaskList.css
│   │   ├── CreateTask.js       # 创建任务组件
│   │   ├── CreateTask.css
│   │   ├── TaskDetail.js       # 任务详情组件
│   │   └── TaskDetail.css
│   ├── App.js                  # 主应用组件
│   ├── App.css
│   └── index.js                # 入口文件
├── package.json
└── README.md
```

## 🎨 功能页面

### 1. 任务列表页面
- 显示所有比对任务
- 支持刷新任务列表
- 点击任务卡片查看详情
- 显示任务状态、进度、创建时间

### 2. 创建任务页面
- 输入两个 PDF 报告的 URL
- 提交后创建新任务
- 显示使用说明和示例

### 3. 任务详情页面
- **摘要标签页**:
  - 统计数据（修改/新增/删除段落和表格）
  - 变化最多的章节
  - 总体评估

- **详细差异标签页**:
  - 按章节显示段落变化
  - 按表格显示单元格变化
  - 显示行标签和列名

## 🔌 API 集成

前端通过 Axios 连接到后端 API:

```javascript
const API_BASE_URL = 'http://localhost:3000/api/v1';
```

### 主要 API 调用

```javascript
// 获取任务列表
GET /api/v1/tasks

// 创建任务
POST /api/v1/tasks/compare/url
{
  "urlA": "https://example.com/report1.pdf",
  "urlB": "https://example.com/report2.pdf"
}

// 获取任务详情
GET /api/v1/tasks/:taskId

// 获取差异结果
GET /api/v1/tasks/:taskId/diff

// 获取摘要
GET /api/v1/tasks/:taskId/summary
```

## 🎯 使用流程

1. **打开应用**: 访问 `http://localhost:3000`
2. **查看任务**: 在"任务列表"页面查看已有任务
3. **创建任务**: 点击"创建任务"，输入两个 PDF URL
4. **查看结果**: 点击任务卡片查看详细差异

## 🧪 测试数据

后端 Mock API 会返回示例数据，包括:
- 段落变化
- 表格单元格变化
- 统计数据
- 摘要信息

## 📱 响应式设计

前端支持多种屏幕尺寸:
- 桌面版 (1200px+)
- 平板版 (768px - 1199px)
- 手机版 (< 768px)

## 🎨 样式特点

- 现代化的渐变色设计
- 清晰的卡片布局
- 平滑的过渡动画
- 易于理解的图标和颜色编码

## 🔧 开发

### 修改样式

编辑 `src/components/*.css` 文件

### 修改组件

编辑 `src/components/*.js` 文件

### 添加新功能

1. 创建新组件: `src/components/NewComponent.js`
2. 在 `App.js` 中导入并使用
3. 添加对应的 CSS 文件

## 📦 依赖

- **React**: UI 框架
- **Axios**: HTTP 客户端
- **React Scripts**: 构建工具

## 🚨 常见问题

### Q: 前端无法连接到后端？
A: 确保后端服务运行在 `http://localhost:3000`，检查浏览器控制台的错误信息。

### Q: 如何修改 API 地址？
A: 编辑 `src/App.js` 中的 `API_BASE_URL` 变量。

### Q: 如何部署到生产环境？
A: 运行 `npm run build`，将 `build` 文件夹部署到 Web 服务器。

## 📚 相关文档

- [后端 API 文档](./API.md)
- [系统架构](./IMPLEMENTATION_GUIDE.md)
- [快速参考](./QUICK_REFERENCE.md)

---

**前端已准备就绪！** 🎉

现在你可以启动前端应用并开始测试了。
