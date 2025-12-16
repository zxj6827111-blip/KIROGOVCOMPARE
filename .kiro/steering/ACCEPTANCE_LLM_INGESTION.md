# ACCEPTANCE：LLM 解析与入库系统（A 路线）

> 版本：v3（口径统一版）  
> 日期：2025-12-15

## 0. 核心决策检查（必须一致）
- DB：生产 PostgreSQL，本地可选 SQLite
- reports：UNIQUE(region_id, year)
- report_versions：UNIQUE(report_id, file_hash)
- Prompt：prompts/vN/system.txt|user.txt|schema.json
- API ID：integer

## 1. 功能验收（P0）
- [ ] 上传：PDF/≤50MB/hash/落盘
- [ ] 解析：Job 状态机 + 重试 + Schema 校验
- [ ] 入库：report_versions 版本化 + is_active
- [ ] 幂等：同城同年同文件不重复解析
- [ ] 查询与对比：reports/jobs/compare API 可用

## 2. 安全验收（P0）
- [ ] 前端源码与构建产物不含 Key
- [ ] 后端日志不泄露 fullText/Key/parsed_json 全量

## 3. 必跑命令（可复现）

### 3.1 环境变量（.env）
```
LLM_PROVIDER=gemini
GEMINI_API_KEY=***
GEMINI_MODEL=gemini-2.5-flash
PROMPT_VERSION=v1
DATABASE_URL=postgresql://localhost:5432/llm_ingestion
# 或 DATABASE_URL=sqlite:///./data.db
```

### 3.2 启动（建议脚本）
```bash
npm install
npm run db:migrate -- --db=postgres   # 或 --db=sqlite
npm run dev:api
```

另一个终端（前端）：
```bash
npm run dev:web
```

### 3.3 健康检查
```bash
curl -s http://localhost:3000/api/health
```

### 3.4 数据流冒烟（curl）
```bash
curl -s -X POST http://localhost:3000/api/regions \
  -H "Content-Type: application/json" \
  -d '{"code":"huangpu","name":"黄浦区","province":"上海市"}'

curl -s -X POST http://localhost:3000/api/reports \
  -F "regionId=1" \
  -F "year=2024" \
  -F "file=@sample.pdf"

curl -s http://localhost:3000/api/jobs/1
curl -s "http://localhost:3000/api/reports?regionId=1&year=2024"
curl -s http://localhost:3000/api/reports/1
curl -s "http://localhost:3000/api/reports/compare?regionId=1&years=2023,2024"
```

### 3.5 幂等验证（必须通过）
```bash
curl -i -X POST http://localhost:3000/api/reports \
  -F "regionId=1" -F "year=2024" -F "file=@sample.pdf"
```

### 3.6 关键一致性 grep（文档/实现前）
```bash
grep -R "UNIQUE(region_id, year)" -n .
grep -R "UNIQUE(report_id, file_hash)" -n .
grep -R "prompts/v" -n .
```

## 4. 通过标准
- P0 功能验收全绿
- 安全验收全绿
- 冒烟与幂等验证全绿
