# 完整系统启动指南

## 🎯 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    用户浏览器                             │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────────┐         ┌──────────────────┐      │
│  │  前端应用        │         │  后端管理页面    │      │
│  │  (React)         │         │  (HTML/CSS/JS)   │      │
│  │  :3000           │         │  :3000           │      │
│  └────────┬─────────┘         └────────┬─────────┘      │
│           │                            │                 │
└───────────┼────────────────────────────┼─────────────────┘
            │                            │
            └────────────┬───────────────┘
                         │
                    API 调用
                         │
            ┌────────────▼───────────────┐
            │   后端 Mock API            │
            │   (Node.js/Express)        │
            │   :3000/api/v1             │
            └────────────────────────────┘
```

## 🚀 快速启动

### 方式 1: 启动后端管理页面（推荐）

```bash
# 后端已运行，直接访问
http://localhost:3000
```

✅ 功能：
- 查看系统状态
- 创建比对任务
- 查看任务列表
- 查看 API 文档

### 方式 2: 启动前端应用

```bash
cd frontend
npm install
npm start
```

✅ 功能：
- 完整的任务管理界面
- 详细的差异展示
- 摘要和统计数据

### 方式 3: 同时启动前后端

```bash
chmod +x start-all.sh
./start-all.sh
```

## 📍 访问地址

| 应用 | 地址 | 说明 |
|------|------|------|
| 后端管理页面 | http://localhost:3000 | 内置管理界面 |
| 前端应用 | http://localhost:3000 (React) | React 开发服务器 |
| API 基础 URL | http://localhost:3000/api/v1 | REST API |
| 健康检查 | http://localhost:3000/health | 服务状态 |

## 🔄 工作流程

### 完整的比对流程

```
1. 打开后端管理页面
   http://localhost:3000
   ↓
2. 创建新任务
   输入两个 PDF URL
   ↓
3. 查看任务状态
   监控处理进度
   ↓
4. 任务完成
   查看差异结果
   ↓
5. 打开前端应用（可选）
   查看详细的差异展示
```

## 📊 后端管理页面功能

### 系统监控
- 实时任务统计
- 服务器运行时间
- API 版本信息

### 任务管理
- 创建新任务
- 查看任务列表
- 监控任务状态

### API 文档
- 完整的 API 端点列表
- 请求方法说明
- 使用示例

## 🎨 前端应用功能

### 任务列表
- 显示所有任务
- 任务卡片展示
- 快速查看详情

### 创建任务
- URL 输入表单
- 任务创建向导
- 使用说明

### 任务详情
- 差异摘要
- 详细变化列表
- 统计数据展示

## 🔌 API 端点

### 任务相关
```
GET    /api/v1/tasks                    # 获取任务列表
GET    /api/v1/tasks/:taskId            # 获取单个任务
POST   /api/v1/tasks/compare/url        # 创建比对任务
GET    /api/v1/tasks/:taskId/diff       # 获取差异结果
GET    /api/v1/tasks/:taskId/summary    # 获取摘要
```

### 资产相关
```
GET    /api/v1/assets                   # 获取资产列表
POST   /api/v1/assets/upload            # 上传资产
```

### 建议相关
```
GET    /api/v1/tasks/:taskId/suggestions # 获取 AI 建议
```

## 💡 使用示例

### 示例 1: 使用后端管理页面创建任务

1. 打开 http://localhost:3000
2. 在"创建新任务"表单中输入：
   - URL A: https://example.com/report2023.pdf
   - URL B: https://example.com/report2024.pdf
3. 点击"创建任务"
4. 查看"最近任务"列表中的新任务

### 示例 2: 使用 API 创建任务

```bash
curl -X POST http://localhost:3000/api/v1/tasks/compare/url \
  -H "Content-Type: application/json" \
  -d '{
    "urlA": "https://example.com/report2023.pdf",
    "urlB": "https://example.com/report2024.pdf"
  }'
```

### 示例 3: 获取任务差异

```bash
curl http://localhost:3000/api/v1/tasks/{taskId}/diff
```

## 🧪 测试数据

后端 Mock API 会返回示例数据，包括：
- 段落变化（修改、新增、删除）
- 表格单元格变化
- 统计数据
- 摘要信息

## 📱 支持的设备

- ✅ 桌面浏览器 (Chrome, Firefox, Safari, Edge)
- ✅ 平板设备 (iPad, Android Tablet)
- ✅ 手机设备 (iPhone, Android Phone)

## 🔧 系统要求

- Node.js 14+
- npm 6+
- 现代浏览器（支持 ES6）

## 🚨 故障排查

### 后端无法启动
```bash
# 检查端口是否被占用
lsof -i :3000

# 如果被占用，杀死进程
kill -9 <PID>

# 重新启动
node dist/index-mock.js
```

### 前端无法连接到后端
- 确保后端服务运行在 http://localhost:3000
- 检查浏览器控制台的错误信息
- 检查 CORS 配置

### 任务创建失败
- 检查输入的 URL 是否正确
- 确保 URL 指向有效的 PDF 文件
- 检查网络连接

## 📚 相关文档

- [后端管理页面指南](./BACKEND_ADMIN_GUIDE.md)
- [前端设置指南](./FRONTEND_SETUP.md)
- [API 文档](./API.md)
- [快速参考](./QUICK_REFERENCE.md)
- [实现指南](./IMPLEMENTATION_GUIDE.md)

## 🎉 总结

系统现在已完全就绪：

✅ **后端服务** - 运行在 http://localhost:3000  
✅ **后端管理页面** - 内置 Web 界面  
✅ **前端应用** - React 应用（可选）  
✅ **Mock API** - 提供示例数据  
✅ **完整文档** - 详细的使用指南  

现在你可以：
1. 访问 http://localhost:3000 使用后端管理页面
2. 创建比对任务
3. 查看任务结果
4. 启动前端应用查看详细信息

---

**系统已准备就绪！** 🚀

开始使用年报比对系统吧！
