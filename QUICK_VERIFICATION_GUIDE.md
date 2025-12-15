# P0 修复快速验证指南

## 前置条件
- Docker & Docker Compose 已安装
- Node.js 18+ 已安装
- Python 3.8+ 已安装
- 项目已构建：`npm run build`

---

## 验证步骤

### 1️⃣ 验证 P0-1 + P0-2：Docker 启动 + 环境变量

```bash
# 清理旧容器
docker compose down -v

# 一键启动（包含构建）
docker compose up -d --build

# 等待 30 秒让容器完全启动
sleep 30

# 检查容器状态
docker ps | grep -E "api|worker|postgres|redis"

# 应该看到 4 个容器都在运行
```

**验证日志**：
```bash
# 检查 API 日志
docker logs $(docker ps -q -f "label=com.docker.compose.service=api") | grep -E "Database connection|Redis Client Connected"

# 应该看到：
# ✓ Database connection successful
# ✓ Redis Client Connected
```

---

### 2️⃣ 验证 P0-7：/content 返回解析数据

```bash
# 上传一份 PDF（假设已有 sample_pdfs_v1/sample_report_2023_beijing.pdf）
curl -X POST http://localhost:3000/api/v1/assets/upload \
  -F "file=@sample_pdfs_v1/sample_report_2023_beijing.pdf"

# 记录返回的 assetId，假设为 asset_xxx

# 请求 /content 端点
curl http://localhost:3000/api/v1/assets/asset_xxx/content | jq .

# 应该返回完整的 parseData，包含：
# {
#   "documentId": "...",
#   "assetId": "asset_xxx",
#   "title": "政府信息公开年度报告",
#   "sections": [
#     {
#       "id": "section_1",
#       "title": "一、概述",
#       "content": [...],
#       "tables": [...]
#     },
#     ...
#   ]
# }
```

---

### 3️⃣ 验证 P0-3 + P0-4 + P0-5：Python 表格提取 + 指标化

```bash
# 创建样例 PDF
node scripts/create-sample-pdfs.js

# 运行回归测试
node scripts/regress_tables.js

# 应该看到输出：
# 📊 表格提取回归测试
# ✓ 找到 3 份样例 PDF
# 
# [1/3] 处理: sample_report_2023_beijing.pdf
#   ✓ 成功 (XXXms)
#   📊 3 张表: X 完整, X 部分, X 失败
#   📈 平均置信度: X.XX
# ...
# 📋 测试完成
#   ✓ 成功: 3/3
#   ❌ 失败: 0/3
#   ⏱️  平均耗时: XXXms
# 
# 📄 详细报告: test-sample-pdfs-report.json
```

**查看详细报告**：
```bash
cat test-sample-pdfs-report.json | jq '.results[0].analysis.tables'

# 应该看到每张表的指标：
# {
#   "sec2_art20_active_disclosure": {
#     "title": "表2：主动公开政府信息情况",
#     "completeness": "complete",
#     "metrics": {
#       "nonEmptyCells": 150,
#       "totalCells": 280,
#       "nonEmptyRatio": "0.54",
#       "matchedRows": 28,
#       "expectedRows": 28,
#       "rowMatchRate": "1.00",
#       "numericParseRate": "0.85",
#     },
#     "confidence": "0.78",
#     "issues": []
#   },
#   ...
# }
```

---

### 4️⃣ 验证 P0-6：回归脚本完整性

```bash
# 检查样例 PDF 是否存在
ls -lh sample_pdfs_v1/

# 应该看到 3 份 PDF：
# -rw-r--r--  sample_report_2023_beijing.pdf
# -rw-r--r--  sample_report_2023_shanghai.pdf
# -rw-r--r--  sample_report_2023_guangzhou.pdf

# 检查报告文件
ls -lh test-sample-pdfs-report.json

# 验证报告内容
cat test-sample-pdfs-report.json | jq '.summary'

# 应该看到：
# {
#   "totalPdfs": 3,
#   "successCount": 3,
#   "failureCount": 0,
#   "avgElapsedMs": XXX
# }
```

---

### 5️⃣ 验证 Python 脚本独立运行

```bash
# 直接运行 Python 脚本
python3 python/extract_tables_pdfplumber.py \
  sample_pdfs_v1/sample_report_2023_beijing.pdf \
  --schema src/schemas/annual_report_table_schema_v2.json \
  --out -

# 应该输出 JSON，包含：
# {
#   "schema_version": "annual_report_table_schema_v2",
#   "tables": {
#     "sec2_art20_active_disclosure": {...},
#     "sec3_requests": {...},
#     "sec4_review_litigation": {...}
#   },
#   "issues": [],
#   "runtime": {
#     "engine": "pdfplumber",
#     "elapsed_ms": XXX
#   }
# }
```

---

### 6️⃣ 验证 Worker 日志

```bash
# 查看 Worker 日志
docker logs $(docker ps -q -f "label=com.docker.compose.service=worker") --tail 100

# 应该看到：
# [Worker] 启动 Python 表格提取 (A)
# [Worker] Python 表格提取成功 (A): 3 张表
#   耗时: XXXms, 置信度: X.XX
# [Worker] 启动 Python 表格提取 (B)
# [Worker] Python 表格提取成功 (B): 3 张表
#   耗时: XXXms, 置信度: X.XX
```

---

## 完整验收清单

| 项目 | 验证命令 | 预期结果 |
|------|--------|--------|
| P0-1 | `docker compose up -d --build` | 4 个容器正常运行 |
| P0-2 | `docker logs api \| grep "Database connection"` | 出现成功连接日志 |
| P0-2 | `docker logs api \| grep "Redis Client Connected"` | 出现 Redis 连接日志 |
| P0-3 | `docker logs worker \| grep "python table extraction"` | 出现 Python 提取日志 |
| P0-4 | `cat test-sample-pdfs-report.json \| jq '.results[0].analysis'` | 无示例填充值 |
| P0-5 | `cat test-sample-pdfs-report.json \| jq '.results[0].analysis.tables[].metrics'` | 包含完整指标 |
| P0-6 | `node scripts/regress_tables.js` | 3/3 成功 |
| P0-7 | `curl http://localhost:3000/api/v1/assets/{id}/content` | 返回完整 parseData |

---

## 故障排查

### 问题：Docker 构建失败
```bash
# 清理并重试
docker compose down -v
docker system prune -a
docker compose up -d --build
```

### 问题：Python 脚本找不到
```bash
# 检查文件是否存在
ls -la python/extract_tables_pdfplumber.py

# 检查权限
chmod +x python/extract_tables_pdfplumber.py
```

### 问题：样例 PDF 不存在
```bash
# 重新创建
node scripts/create-sample-pdfs.js
ls -la sample_pdfs_v1/
```

### 问题：回归脚本失败
```bash
# 查看详细错误
node scripts/regress_tables.js 2>&1 | tail -50

# 检查 schema 文件
cat src/schemas/annual_report_table_schema_v2.json | jq '.tables | length'
```

---

## 性能基准

| 操作 | 预期耗时 |
|------|--------|
| Docker 构建 | 2-5 分钟 |
| Docker 启动 | 30 秒 |
| 单个 PDF 表格提取 | 5-10 秒 |
| 3 份 PDF 回归测试 | 20-30 秒 |

---

## 下一步

所有 P0 项验收通过后：
1. 提交代码到 Git
2. 进行 P1 硬化（重试、超时、幂等）
3. 准备上线联调

---

## 快速命令速查

```bash
# 一键启动
docker compose up -d --build && sleep 30

# 一键验证
npm run build && \
node scripts/create-sample-pdfs.js && \
node scripts/regress_tables.js && \
cat test-sample-pdfs-report.json | jq '.summary'

# 查看所有日志
docker compose logs -f

# 停止系统
docker compose down

# 清理所有数据
docker compose down -v
```
