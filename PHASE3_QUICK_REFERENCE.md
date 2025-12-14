# 第三阶段快速参考指南

## 🚀 快速启动

### 1. 安装依赖
```bash
npm install
cd frontend && npm install && cd ..
```

### 2. 启动系统
```bash
# 终端 1: 启动后端
npm run dev

# 终端 2: 启动前端
cd frontend && npm start
```

### 3. 访问应用
- 前端：http://localhost:3000
- 后端 API：http://localhost:3000/api/v1

---

## 📝 API 快速参考

### 创建任务 - 文件上传

```bash
curl -X POST http://localhost:3000/api/v1/tasks/compare/upload \
  -F "fileA=@report-a.pdf" \
  -F "fileB=@report-b.pdf" \
  -H "x-user-id: user123"
```

**响应**：
```json
{
  "taskId": "task_xxx",
  "status": "queued",
  "assetIdA": "asset_xxx",
  "assetIdB": "asset_xxx",
  "createdAt": "2024-12-14T10:00:00Z"
}
```

### 创建任务 - URL 方式

```bash
curl -X POST http://localhost:3000/api/v1/tasks/compare/url \
  -H "Content-Type: application/json" \
  -H "x-user-id: user123" \
  -d '{
    "urlA": "https://example.com/report-a.pdf",
    "urlB": "https://example.com/report-b.pdf"
  }'
```

### 查询任务状态

```bash
curl http://localhost:3000/api/v1/tasks/task_xxx
```

**响应**：
```json
{
  "taskId": "task_xxx",
  "status": "running",
  "stage": "diffing",
  "progress": 60,
  "message": "差异比对中...",
  "warnings": []
}
```

### 查询任务列表

```bash
curl "http://localhost:3000/api/v1/tasks?status=succeeded&page=1&limit=20" \
  -H "x-user-id: user123"
```

### 获取差异结果

```bash
curl http://localhost:3000/api/v1/tasks/task_xxx/diff
```

### 获取摘要信息

```bash
curl http://localhost:3000/api/v1/tasks/task_xxx/summary
```

### 下载报告

```bash
curl http://localhost:3000/api/v1/tasks/task_xxx/download/diff \
  -o report.docx
```

### 删除任务

```bash
curl -X DELETE http://localhost:3000/api/v1/tasks/task_xxx
```

---

## 🎨 前端使用指南

### 创建任务

1. **选择上传方式**
   - 📍 按地区年份：从资料库选择
   - 🔗 按 URL：输入两个 URL
   - 📤 上传文件：选择两个 PDF 文件

2. **上传文件方式**
   - 点击"📤 上传文件"标签
   - 选择第一份 PDF 文件
   - 选择第二份 PDF 文件
   - 点击"🚀 上传并创建任务"

3. **URL 方式**
   - 点击"🔗 按 URL"标签
   - 输入第一份报告的 URL
   - 输入第二份报告的 URL
   - 点击"🚀 创建任务"

### 查看任务列表

1. **筛选任务**
   - 选择状态筛选器
   - 支持：全部、等待中、处理中、已完成、失败

2. **查看任务详情**
   - 点击"查看详情"按钮
   - 查看完整的差异结果

3. **管理任务**
   - 📥 下载报告：下载 DOCX 格式的对比报告
   - 🗑️ 删除：删除任务及相关数据

### 查看结果

1. **差异摘要**
   - 总体评估
   - 变化最多的章节
   - 关键数字变化

2. **详细对比**
   - 按章节导航
   - 查看新增/删除/修改内容
   - 查看表格对比

---

## 🔧 常见问题

### Q: 文件上传失败怎么办？

**A**: 检查以下几点：
- 文件格式是否为 PDF
- 文件大小是否超过 100MB
- 网络连接是否正常

### Q: 任务处理很慢怎么办？

**A**: 这是正常的，处理时间取决于：
- PDF 文件大小
- 文件内容复杂度
- 系统负载

通常需要 1-5 分钟。

### Q: 如何查看处理进度？

**A**: 
- 在任务列表中查看进度条
- 进度条显示当前处理百分比
- 旁边显示当前处理阶段

### Q: 如何下载对比报告？

**A**:
- 任务完成后，点击"📥 下载报告"
- 自动下载 DOCX 格式的报告
- 可以在 Word 中打开和编辑

### Q: 如何删除任务？

**A**:
- 点击"🗑️ 删除"按钮
- 确认删除
- 任务及相关数据将被删除

---

## 📊 任务状态说明

| 状态 | 说明 | 颜色 |
|------|------|------|
| queued | 等待处理 | 🟠 橙色 |
| running | 处理中 | 🔵 蓝色 |
| succeeded | 已完成 | 🟢 绿色 |
| failed | 处理失败 | 🔴 红色 |

---

## 🔄 处理阶段说明

| 阶段 | 说明 | 进度 |
|------|------|------|
| ingesting | 摄入文件 | 0-15% |
| parsing | 解析 PDF | 15-25% |
| structuring | 结构化 | 25-45% |
| diffing | 比对差异 | 45-65% |
| summarizing | 生成摘要 | 65-85% |
| exporting | 导出报告 | 85-100% |

---

## 💾 数据存储

### 文件存储位置

```
uploads/
├── assets/          # 上传的 PDF 文件
├── temp/            # 临时文件
└── exports/         # 导出的 DOCX 报告
```

### 数据库表

```
compare_tasks       # 比对任务
report_assets       # 年报资产
diff_results        # 差异结果
export_jobs         # 导出任务
ai_suggestions      # AI 建议
```

---

## 🧪 测试命令

### 运行集成测试

```bash
npm run test:integration
```

### 运行所有测试

```bash
npm test
```

### 生成覆盖率报告

```bash
npm run test:coverage
```

### 运行特定测试

```bash
npm test -- --testNamePattern="文件上传"
```

---

## 🔐 安全建议

1. **文件上传**
   - 验证文件格式
   - 限制文件大小
   - 扫描恶意代码

2. **URL 下载**
   - 验证 URL 格式
   - 防止 SSRF 攻击
   - 限制重定向次数

3. **数据保护**
   - 加密敏感数据
   - 定期备份
   - 访问控制

---

## 📈 性能优化

### 缓存策略

- 解析结果缓存：避免重复解析
- AI 建议缓存：避免重复调用 API
- 资产去重：基于文件哈希

### 异步处理

- 使用队列处理长时任务
- 不阻塞前端界面
- 实时进度反馈

---

## 🚨 故障排查

### 后端无法启动

```bash
# 检查端口是否被占用
lsof -i :3000

# 检查数据库连接
npm run test:db

# 查看日志
npm run dev 2>&1 | tee app.log
```

### 前端无法连接后端

```bash
# 检查后端是否运行
curl http://localhost:3000/health

# 检查 CORS 配置
# 查看浏览器控制台错误信息
```

### 任务处理失败

```bash
# 查看任务错误信息
curl http://localhost:3000/api/v1/tasks/task_xxx

# 查看警告列表
# 检查日志文件
```

---

## 📚 相关文档

- **完整需求** → `.kiro/specs/gov-report-diff/requirements.md`
- **系统设计** → `.kiro/specs/gov-report-diff/design.md`
- **实现计划** → `.kiro/specs/gov-report-diff/tasks.md`
- **第三阶段完成** → `PHASE3_COMPLETION.md`

---

## 💡 最佳实践

1. **定期备份数据**
   - 备份数据库
   - 备份上传的文件

2. **监控系统状态**
   - 监控 CPU 使用率
   - 监控内存使用率
   - 监控磁盘空间

3. **定期清理**
   - 清理临时文件
   - 清理过期任务
   - 清理日志文件

4. **安全更新**
   - 定期更新依赖
   - 修复安全漏洞
   - 测试更新

---

**最后更新**：2024-12-14

**版本**：3.0.0

**状态**：✅ 生产就绪
