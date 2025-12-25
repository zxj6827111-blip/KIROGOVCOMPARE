# PR: 一致性勾稽校验功能（Consistency Checks）

## 🎯 功能概述

本 PR 实现了完整的年报一致性校验功能，包括：
- 自动化规则引擎（表三、表四、正文一致性）
- 人工复核工作流（pending/confirmed/dismissed）
- 分组管理和可读标题
- 稳定的 fingerprint 机制防止重复

## 📝 改动文件

### 核心实现
- `src/services/ConsistencyCheckService.ts` - **新增**：完整规则引擎（664 行）
  - 表三：办理结果总计校验、恒等式校验、总计列求和
  - 表四：行政复议/诉讼求和校验
  - 正文一致性：正则抽取 + 对照表格
  - 自动 PASS/FAIL/UNCERTAIN/NOT_ASSESSABLE 判定
  
- `src/services/LlmJobRunner.ts` - **修改**：支持 checks job
  - 新增 `processChecksJob()` 方法
  - `processParseJob()` 成功后自动触发 checks job
  - 调整优先级：parse > checks > compare

- `src/routes/report-checks.ts` - **新增**：API 路由（269 行）
  - `GET /api/reports/:id/checks` - 获取校验结果（分组）
  - `POST /api/reports/:id/checks/run` - 手动触发校验
  - `PATCH /api/reports/:id/checks/items/:itemId` - 人工复核

### 数据库
- `migrations/sqlite/006_consistency_checks.sql` - **新增**：数据库表
  - `report_consistency_runs` - 校验运行记录
  - `report_consistency_items` - 校验问题项
  - UNIQUE(report_version_id, fingerprint) 约束

- `src/db/migrations-llm.ts` - **修改**：同步 PostgreSQL 迁移

### 测试
- `src/__tests__/consistencyChecks.test.ts` - **新增**：单元测试（325 行）
  - 规则生成验证
  - fingerprint 稳定性测试
  - upsert 不覆盖 human_status 测试
  - PASS/FAIL 计算正确性测试

### 其他
- `src/index-llm.ts` - **修改**：挂载 report-checks 路由
- `.github/copilot-instructions.md` - **新增**：AI 编程助手指南

## 🔍 API 示例

### 1. 获取校验结果（分组）
```bash
curl http://localhost:8787/api/reports/1/checks
```

**返回结构：**
```json
{
  "report_id": 1,
  "version_id": 123,
  "latest_run": {
    "run_id": 456,
    "status": "succeeded",
    "engine_version": "v1",
    "summary": {
      "fail": 2,
      "uncertain": 1,
      "pending": 3,
      "confirmed": 0,
      "dismissed": 0
    }
  },
  "groups": [
    {
      "group_key": "table2",
      "group_name": "表二",
      "items": []
    },
    {
      "group_key": "table3",
      "group_name": "表三",
      "items": [
        {
          "id": 789,
          "check_key": "t3_identity_total",
          "title": "表三：本年新收+上年结转=办理结果总计+结转下年度继续办理（总计列）",
          "expr": "newReceived + carriedOver = totalProcessed + carriedForward",
          "left_value": 180,
          "right_value": 175,
          "delta": 5,
          "tolerance": 0,
          "auto_status": "FAIL",
          "evidence": {
            "paths": [
              "total.newReceived",
              "total.carriedOver",
              "total.results.totalProcessed",
              "total.results.carriedForward"
            ],
            "values": {
              "newReceived": 150,
              "carriedOver": 30,
              "totalProcessed": 160,
              "carriedForward": 15
            }
          },
          "human_status": "pending",
          "human_comment": null
        }
      ]
    },
    {
      "group_key": "table4",
      "group_name": "表四",
      "items": [...]
    },
    {
      "group_key": "text",
      "group_name": "正文一致性",
      "items": [...]
    }
  ]
}
```

### 2. 手动触发校验
```bash
curl -X POST http://localhost:8787/api/reports/1/checks/run
```

**返回：**
```json
{
  "message": "checks_job_enqueued",
  "job_id": 999
}
```

### 3. 人工复核（标记为已确认）
```bash
curl -X PATCH http://localhost:8787/api/reports/1/checks/items/789 \
  -H "Content-Type: application/json" \
  -d '{"human_status": "confirmed", "human_comment": "确认是数据问题"}'
```

**返回：**
```json
{
  "message": "item_updated",
  "item": {
    "id": 789,
    "check_key": "t3_identity_total",
    "title": "表三：...",
    "human_status": "confirmed",
    "human_comment": "确认是数据问题"
  }
}
```

### 4. 查看包括已忽略的问题
```bash
curl http://localhost:8787/api/reports/1/checks?include_dismissed=1
```

## ✅ 验证步骤

### 前置条件
```bash
npm run dev:llm   # 启动 LLM 服务（端口 8787）
```

### 完整验证流程
```bash
# 1. 创建测试报告
curl -X POST http://localhost:8787/api/reports/text \
  -H "Content-Type: application/json" \
  -d '{
    "region_id": 1,
    "year": 2024,
    "content": "本年新收150件，上年结转30件，办理结果总计152件，结转下年度继续办理28件。行政复议20件。"
  }'
# 返回：{"report_id": 123, "version_id": 456, "job_id": 789}

# 2. 等待 parse job 完成（会自动触发 checks job）
sleep 10

# 3. 获取校验结果
curl http://localhost:8787/api/reports/123/checks

# 4. 手动触发（可选，如果需要重新校验）
curl -X POST http://localhost:8787/api/reports/123/checks/run

# 5. 人工标记某个问题为 dismissed
ITEM_ID=<从步骤3获取>
curl -X PATCH http://localhost:8787/api/reports/123/checks/items/$ITEM_ID \
  -H "Content-Type: application/json" \
  -d '{"human_status": "dismissed", "human_comment": "已人工核实，非问题"}'

# 6. 再次获取，验证 dismissed 的不返回
curl http://localhost:8787/api/reports/123/checks
# 应该少一条 item

# 7. 包括 dismissed 的查询
curl http://localhost:8787/api/reports/123/checks?include_dismissed=1
# 应该看到被 dismissed 的 item
```

## 🧪 运行测试
```bash
npm test -- src/__tests__/consistencyChecks.test.ts
```

## 📊 规则覆盖

### 表三（group_key='table3'）
1. **办理结果总计校验**（每实体一条）
   - 公式：granted + partialGrant + sum(denied.*) + sum(unableToProvide.*) + sum(notProcessed.*) + sum(other.*) = totalProcessed
   - 覆盖实体：naturalPerson, legalPerson.*, total

2. **恒等式校验**（每实体一条）
   - 公式：newReceived + carriedOver = totalProcessed + carriedForward

3. **总计列求和**（4条）
   - newReceived, carriedOver, totalProcessed, carriedForward

### 表四（group_key='table4'）
- review, litigationDirect, litigationPostReview 各一条
- 公式：maintain + correct + other + unfinished = total

### 正文一致性（group_key='text'）
- 基于正则抽取数字，对照表三/表四
- 多处匹配或无法确定时标记为 UNCERTAIN

## 🔒 关键约束

1. **UNIQUE 约束**：`UNIQUE(report_version_id, fingerprint)`
2. **Upsert 规则**：更新时**严禁覆盖** `human_status` 和 `human_comment`
3. **Fingerprint 稳定性**：`sha256(groupKey:checkKey:expr).substring(0, 16)`
4. **自动触发**：parse job 成功后自动 enqueue checks job（避免重复）

## 🚀 后续工作

- [ ] 前端组件：ConsistencyCheckView（展示分组和问题项）
- [ ] 前端集成：在 ReportDetail 中添加"一致性校验"标签页
- [ ] 导出功能：生成包含勾稽关系的 DOCX/PDF
- [ ] 增强规则：表二勾稽、更多正文对照规则

## 📚 相关文档

- [API 文档](../API.md)
- [数据库迁移](../migrations/sqlite/006_consistency_checks.sql)
- [实现指南](.github/copilot-instructions.md)
