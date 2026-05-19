# 政府信息公开年度报告差异比对系统 - 前端

这是政府信息公开年度报告差异比对系统的前端应用，使用 React 构建。

## 🚀 快速开始

### 安装依赖

```bash
cd frontend
npm install
```

### 启动开发服务器

```bash
npm start
```

应用将在 `http://localhost:3001` 打开。

### 构建生产版本

```bash
npm run build
```

## 📋 功能

### Phase 5 新增功能 ✨

- **城市+年份创建任务**: 用户只需选择城市和年份，无需输入 URL
- **全文对照**: 支持并排阅读，三个开关控制显示内容
  - 仅看差异 - 隐藏完全相同的段落
  - 高亮差异 - 高亮修改/新增/删除的文本
  - 高亮相同 - 高亮相同的文本
- **表格对照**: 显示单元格差异和指标分析
  - 单元格变化列表
  - 指标分析表（显示增减值和增减率）

### 基础功能

- **报告上传**: 上传年度报告并等待解析入库
- **报告目录**: 按地区和年份查看已入库报告
- **对比历史**: 查看基于已入库报告生成的对比结果
- **对比详情**: 查看年度差异、表格差异和打印视图

## 🏗️ 项目结构

```
frontend/
├── public/
│   └── index.html
├── src/
│   ├── components/
│   │   ├── ComparisonHistory.js
│   │   ├── ComparisonDetailView.js
│   │   ├── ComparisonHistory.css
│   │   └── ComparisonDetailView.css
│   ├── App.js
│   ├── App.css
│   └── index.js
├── package.json
└── README.md
```

## 🔗 API 端点

前端默认通过同域或开发代理访问后端 API，必要时可通过环境变量指定基地址。

### 目录相关（Phase 5 新增）

- `GET /catalog/regions` - 获取城市列表
- `GET /catalog/years?region=XXX` - 获取年份列表
- `GET /catalog/regions/:region` - 获取城市详情
- `POST /reports` - 上传 PDF 报告，返回 job_id/version_id/report_id（201 或 409）

### Compare 相关

- `POST /comparisons` - 基于已入库报告创建对比
- `GET /comparisons/history` - 获取对比历史
- `GET /comparisons/:comparisonId/result` - 获取对比详情

旧版 `/api/v1/tasks/compare/*` 临时任务管线已物理清理，不再作为前端可用功能。

## 🎨 样式

使用 CSS 进行样式设计，支持响应式布局。

## 📝 环境变量

在 `.env` 文件中配置（可选，默认同域或 package.json proxy 指定的地址）:

```
REACT_APP_API_BASE_URL=http://localhost:3000
```

## 🧪 测试

```bash
npm test
```

## 📦 依赖

- React 18.2.0
- Axios 1.6.2
- React Scripts 5.0.1

## 📄 许可证

MIT
