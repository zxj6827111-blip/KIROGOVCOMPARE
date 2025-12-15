# P0 阻断项修复总结

## 修复时间
2025-12-15

## 修复内容

### P0-1：Docker Compose 一键启动失败
**问题**：Dockerfile 中 `COPY dist ./dist` 但仓库无 dist 目录

**修复方案**：改为 multi-stage 构建
- 第一阶段（builder）：安装依赖、编译 TypeScript、安装 Python 依赖
- 第二阶段（生产）：仅复制构建产物和运行时依赖

**验证方式**：
```bash
docker compose up -d --build
# 检查容器是否正常启动
docker ps | grep api
docker ps | grep worker
```

---

### P0-2：DB/Redis 环境变量不一致
**问题**：
- docker-compose.yml 提供 `DATABASE_URL` 和 `REDIS_URL`
- 代码读取 `DB_HOST/DB_PORT` 和 `REDIS_HOST/REDIS_PORT`

**修复方案**：优先支持 URL，无则回退到单独变量
- `src/config/database.ts`：优先读 `DATABASE_URL`，无则读 `DB_*`
- `src/config/redis.ts`：优先读 `REDIS_URL`，无则读 `REDIS_*`
- `src/config/queue.ts`：解析 `REDIS_URL` 为 host/port/db（bull 需要对象配置）

**验证方式**：
```bash
docker compose up -d
# 查看日志
docker logs <api-container> | grep "Database connection successful"
docker logs <api-container> | grep "Redis Client Connected"
```

---

### P0-3：Python 表格引擎未接入主链路
**问题**：
- Worker 的 parsing 阶段仅调用 TS 抽表，未调用 Python
- Python schema 处理不兼容（tables 为 list，但脚本当 dict 处理）

**修复方案**：
1. 创建 `PythonTableExtractionService`：
   - 支持超时控制（默认 180s）
   - 错误处理和日志记录
   - 返回结构化结果（tables、metrics、issues）

2. 在 `src/queue/processors.ts` 的 parsing 阶段调用 Python：
   - 新增 `table_extraction` 处理阶段
   - 调用 Python 脚本提取三张表
   - 合并结果到文档

3. 修复 Python 脚本 schema 适配：
   - 支持 tables 为 list 或 dict
   - 自动转换为内部 dict 格式

**验证方式**：
```bash
# 查看 Worker 日志
docker logs <worker-container> | grep "python table extraction"
# 应该看到：
# [Worker] 启动 Python 表格提取 (A)
# [Worker] Python 表格提取成功 (A): 3 张表
# 耗时: XXXms, 置信度: X.XX
```

---

### P0-4：禁止示例表格数据兜底
**问题**：当抽表为空时，TS 生成示例数据填充，产生虚假结果

**修复方案**：
- 删除 `generateSampleTableData()` 调用
- 空表只返回空 cells + issues
- 在 warning 中记录失败原因

**验证方式**：
```bash
# 用"抽不到表"的 PDF 测试
# 输出不应包含示例填充值，只有空 cells 和 issues
```

---

### P0-5：complete 判定指标化
**问题**：complete 仅检查行列数量匹配，属于误导性判定

**修复方案**：指标化 complete 判定
- `nonEmptyCellRate`：非空单元格率 > 50%
- `rowMatchRate`：行匹配率 = 100%
- `numericParseRate`：数字解析率 > 70%
- `confidence`：综合置信度 > 70%

complete 判定规则：
```
complete = (rowMatchRate === 1.0) && 
           (nonEmptyCellRate > 0.5) && 
           (numericParseRate > 0.7) && 
           (confidence > 0.7)
```

**验证方式**：
```bash
# 查看表格 metrics
# 应该包含：
# {
#   nonEmptyCells: 150,
#   totalCells: 280,
#   nonEmptyCellRate: "0.54",
#   matchedRows: 28,
#   expectedRows: 28,
#   rowMatchRate: "1.00",
#   numericParseRate: "0.85",
#   confidence: "0.78",
#   complete: true,
#   issues: ["表格质量良好"]
# }
```

---

### P0-6：回归脚本和样例 PDF
**问题**：缺少样例 PDF，回归脚本无法跑通

**修复方案**：
1. 创建 `sample_pdfs_v1/` 目录
2. 创建 3 份样例 PDF：
   - `sample_report_2023_beijing.pdf`
   - `sample_report_2023_shanghai.pdf`
   - `sample_report_2023_guangzhou.pdf`

3. 创建回归脚本 `scripts/regress_tables.js`：
   - 遍历样例 PDF
   - 调用 Python 表格提取
   - 生成详细报告 `test-sample-pdfs-report.json`
   - 输出每表的 metrics 和 issues

**验证方式**：
```bash
# 创建样例 PDF
node scripts/create-sample-pdfs.js

# 运行回归测试
node scripts/regress_tables.js

# 查看报告
cat test-sample-pdfs-report.json
```

---

### P0-7：/api/v1/assets/:assetId/content 返回解析内容
**问题**：/content 端点返回元数据，不返回解析内容

**修复方案**：
- 修改 `AssetService.getAssetContent()`
- 直接调用 `ParsedDataStorageService.loadParseData()`
- 返回完整的结构化解析数据

**验证方式**：
```bash
# 请求 /content 端点
curl http://localhost:3000/api/v1/assets/{assetId}/content

# 应该返回完整的 parseData：
# {
#   documentId: "...",
#   assetId: "...",
#   title: "...",
#   sections: [...],
#   metadata: {...}
# }
```

---

## 文件变更清单

### 新增文件
- `src/services/PythonTableExtractionService.ts` - Python 表格提取服务
- `scripts/regress_tables.js` - 回归测试脚本
- `scripts/create-sample-pdfs.js` - 样例 PDF 生成脚本
- `sample_pdfs_v1/` - 样例 PDF 目录（3 份 PDF）

### 修改文件
- `Dockerfile` - 改为 multi-stage 构建
- `src/config/database.ts` - 支持 DATABASE_URL
- `src/config/redis.ts` - 支持 REDIS_URL
- `src/config/queue.ts` - 解析 REDIS_URL
- `src/services/AssetService.ts` - /content 返回解析数据
- `src/services/PdfParseService.ts` - 禁止兜底、指标化 complete
- `src/queue/processors.ts` - 接入 Python 主链路
- `src/types/index.ts` - 添加 table_extraction 阶段
- `src/types/models.ts` - Table 添加 metrics 字段
- `python/extract_tables_pdfplumber.py` - 支持 tables 为 list

---

## 验收检查清单

### 环境准备
- [ ] 全新机器/空缓存
- [ ] 安装 Docker、Docker Compose
- [ ] 安装 Node.js 18+
- [ ] 安装 Python 3.8+

### P0-1 验收
- [ ] `docker compose up -d --build` 成功
- [ ] api 容器启动且不 crash
- [ ] worker 容器启动且不 crash

### P0-2 验收
- [ ] API 日志出现 "Database connection successful"
- [ ] API 日志出现 "Redis Client Connected"
- [ ] 无重连风暴

### P0-3 验收
- [ ] Worker 日志记录 "python table extraction started/finished"
- [ ] 输出 JSON 三张表非空（nonEmptyCells > 0）
- [ ] Python 脚本可独立运行：
  ```bash
  python3 python/extract_tables_pdfplumber.py <pdf> \
    --schema src/schemas/annual_report_table_schema_v2.json \
    --out -
  ```

### P0-4 验收
- [ ] 用"抽不到表"的 PDF 测试
- [ ] 输出不含示例填充值
- [ ] issues 指向失败原因

### P0-5 验收
- [ ] 任一核心指标低于阈值时，complete = false
- [ ] issues 解释原因

### P0-6 验收
- [ ] `node scripts/regress_tables.js` 成功
- [ ] 产出 `test-sample-pdfs-report.json`
- [ ] 3 份样例结果均不为空表

### P0-7 验收
- [ ] 前端详情页请求一次即可拿到完整 JSON
- [ ] 包含 6 章节正文 + 3 表格

---

## 后续建议

### P1 硬化项（上线前必做）
1. **队列任务重试/退避/幂等**
   - 设置 jobId=taskId 防重复
   - 配置 attempts 和 backoff
   - 区分可重试和不可重试错误

2. **Python 超时/杀进程**
   - 子进程超时后 kill（含子进程树）
   - 错误回传到 TaskService

3. **任务状态机追踪**
   - 明确 stage 迁移路径
   - 失败时记录阶段、原因、metrics

4. **数据索引优化**
   - 按城市/年份/部门/状态/更新时间建索引

### P2 质量优化项
1. **Python 依赖瘦身** - 移除 pandas/numpy
2. **gridless 表格提取** - 配置 table_settings，加入表定位流程

---

## 快速启动命令

```bash
# 1. 构建
npm run build

# 2. 创建样例 PDF
node scripts/create-sample-pdfs.js

# 3. 启动系统
docker compose up -d --build

# 4. 运行回归测试
node scripts/regress_tables.js

# 5. 查看报告
cat test-sample-pdfs-report.json
```

---

## 联系方式
如有问题，请查看各文件的详细注释和日志输出。
