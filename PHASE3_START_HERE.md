# 第三阶段启动指南

## 📋 阶段概述

第三阶段是系统的核心功能完成阶段，将在第二阶段的基础上，完成以下关键工作：

1. **文件上传功能完成** - 实现 multipart/form-data 上传
2. **任务处理流程完成** - 实现完整的异步处理流程
3. **前端界面集成** - 完成上传、历史、结果展示等界面
4. **系统测试** - 端到端集成测试和验收

## 🎯 第三阶段目标

| 目标 | 状态 | 优先级 |
|------|------|--------|
| 文件上传 API 完成 | ⏳ 进行中 | 🔴 高 |
| 任务处理流程完成 | ⏳ 进行中 | 🔴 高 |
| 前端上传界面 | ⏳ 进行中 | 🔴 高 |
| 前端历史界面 | ⏳ 进行中 | 🟡 中 |
| 前端结果展示 | ⏳ 进行中 | 🟡 中 |
| 系统集成测试 | ⏳ 进行中 | 🟡 中 |
| 验收测试 | ⏳ 进行中 | 🟡 中 |

## 📊 工作分解

### 第一天：文件上传与任务创建

**目标**：完成文件上传功能和任务创建流程

#### 任务 1.1：完成文件上传 API
- [ ] 实现 multipart/form-data 解析
- [ ] 实现文件验证（格式、大小）
- [ ] 实现文件存储
- [ ] 实现文件哈希计算
- [ ] 编写单元测试

**文件**：
- `src/routes/tasks.ts` - 更新 `/compare/upload` 端点
- `src/services/FileUploadService.ts` - 完成实现
- `src/services/__tests__/FileUploadService.test.ts` - 新增测试

#### 任务 1.2：完成任务创建流程
- [ ] 实现三种方式的任务创建（upload/url/asset）
- [ ] 实现任务状态管理
- [ ] 实现任务入队
- [ ] 编写集成测试

**文件**：
- `src/services/TaskService.ts` - 完成实现
- `src/routes/tasks.ts` - 完成所有端点

#### 任务 1.3：前端上传界面
- [ ] 创建上传组件
- [ ] 实现文件选择
- [ ] 实现进度显示
- [ ] 实现错误处理

**文件**：
- `frontend/src/components/UploadForm.js` - 新增
- `frontend/src/components/UploadForm.css` - 新增

### 第二天：任务处理与结果展示

**目标**：完成任务处理流程和结果展示

#### 任务 2.1：完成任务处理流程
- [ ] 实现 8 阶段处理流程
- [ ] 实现进度更新
- [ ] 实现警告收集
- [ ] 实现错误处理

**文件**：
- `src/queue/processors.ts` - 完成实现
- `src/services/CompareTaskProcessor.ts` - 完成实现

#### 任务 2.2：前端历史界面
- [ ] 创建任务列表组件
- [ ] 实现任务查询
- [ ] 实现任务筛选
- [ ] 实现任务删除

**文件**：
- `frontend/src/components/TaskHistory.js` - 新增
- `frontend/src/components/TaskHistory.css` - 新增

#### 任务 2.3：前端结果展示
- [ ] 创建结果展示组件
- [ ] 实现差异高亮
- [ ] 实现表格对比
- [ ] 实现导出功能

**文件**：
- `frontend/src/components/DiffResult.js` - 新增
- `frontend/src/components/DiffResult.css` - 新增

### 第三天：测试与验收

**目标**：完成系统测试和验收

#### 任务 3.1：集成测试
- [ ] 编写端到端测试
- [ ] 编写流程测试
- [ ] 编写错误处理测试

**文件**：
- `src/services/__tests__/integration.test.ts` - 更新

#### 任务 3.2：验收测试
- [ ] 验收所有功能
- [ ] 验收所有 API
- [ ] 验收前端界面

#### 任务 3.3：文档编写
- [ ] 编写实现文档
- [ ] 编写 API 文档
- [ ] 编写用户指南

## 🚀 快速开始

### 启动系统

```bash
# 安装依赖
npm install
cd frontend && npm install && cd ..

# 启动后端
npm run dev

# 启动前端（新终端）
cd frontend && npm start
```

### 运行测试

```bash
# 后端测试
npm test

# 前端测试
cd frontend && npm test

# 集成测试
npm run test:integration
```

## 📖 相关文档

- **需求文档** → `.kiro/specs/gov-report-diff/requirements.md`
- **设计文档** → `.kiro/specs/gov-report-diff/design.md`
- **任务清单** → `.kiro/specs/gov-report-diff/tasks.md`
- **第二阶段总结** → `PHASE2_COMPLETE.md`

## 🔍 关键文件

### 后端核心文件

```
src/
├── routes/
│   └── tasks.ts              # 任务 API 路由
├── services/
│   ├── TaskService.ts        # 任务管理服务
│   ├── FileUploadService.ts  # 文件上传服务
│   ├── CompareTaskProcessor.ts # 任务处理器
│   └── __tests__/            # 测试文件
└── queue/
    └── processors.ts         # 队列处理器
```

### 前端核心文件

```
frontend/src/
├── components/
│   ├── UploadForm.js         # 上传表单
│   ├── TaskHistory.js        # 任务历史
│   └── DiffResult.js         # 结果展示
└── App.js                    # 主应用
```

## ✅ 验收标准

### 功能验收

- ✅ 文件上传功能正常
- ✅ 任务创建成功
- ✅ 任务处理完成
- ✅ 结果展示正确
- ✅ 导出功能正常

### 质量验收

- ✅ 代码编译通过
- ✅ 类型检查通过
- ✅ 所有测试通过
- ✅ 代码覆盖率 > 80%

### 用户体验验收

- ✅ 界面友好易用
- ✅ 错误提示清晰
- ✅ 性能满足要求
- ✅ 文档完整清晰

## 📞 支持

如有问题，请查看相关文档或联系开发团队。

---

**开始日期**：2024-12-14

**预计完成**：3 天

**版本**：3.0.0

**状态**：🟡 进行中
