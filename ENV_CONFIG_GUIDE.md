# 异步任务系统 - .env 配置指南

## ModelScope API 配置

根据您的需求，配置如下：

### 1. 获取 ModelScope API Key

访问 https://modelscope.cn/ 获取您的 API Key

### 2. 更新 .env 文件

在 `.env` 文件中添加以下配置：

```bash
# ===== AI 模型配置 =====

# ModelScope API Key（必填）
MODELSCOPE_API_KEY=your_modelscope_api_key_here

# 主模型（第一轮解析）- Qwen3-235B
LLM_PROVIDER=modelscope
LLM_MODEL=Qwen/Qwen3-235B-Instruct

# Fallback 模型（第二轮重试）- GLM-4.7
LLM_FALLBACK_PROVIDER=modelscope
LLM_FALLBACK_MODEL=ZhipuAI/glm-4-plus

# ModelScope 输入限制（可选，默认 30000 字符）
MODELSCOPE_INPUT_MAX_CHARS=30000
```

## 完整的 .env 示例

```bash
# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gov_report_diff
DB_USER=postgres
DB_PASSWORD=postgres

# Redis 配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

# S3/文件存储配置
STORAGE_TYPE=local
STORAGE_PATH=./uploads
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET=gov-report-diff

# 服务器配置
PORT=3000
NODE_ENV=development

# ===== AI 模型配置 =====

# ModelScope API Key（必填）
MODELSCOPE_API_KEY=your_modelscope_api_key_here

# 主模型（第一轮解析）- Qwen3-235B
LLM_PROVIDER=modelscope
LLM_MODEL=Qwen/Qwen3-235B-Instruct

# Fallback 模型（第二轮重试）- GLM-4.7
LLM_FALLBACK_PROVIDER=modelscope
LLM_FALLBACK_MODEL=ZhipuAI/glm-4-plus

# ModelScope 输入限制（可选）
MODELSCOPE_INPUT_MAX_CHARS=30000

# 日志配置
LOG_LEVEL=info
```

## 注意事项

1. **模型名称格式**: ModelScope 的模型名称格式为 `组织/模型名`
   - Qwen3-235B: `Qwen/Qwen3-235B-Instruct`
   - GLM-4.7: `ZhipuAI/glm-4-plus`

2. **API Key 获取**: 
   - 登录 https://modelscope.cn/
   - 进入个人中心 → API Token
   - 创建或复制您的 API Key

3. **重试逻辑**:
   - 第1轮: 使用 Qwen3-235B (PRIMARY)
   - 第1轮失败 → 第2轮: 使用 GLM-4.7 (FALLBACK)
   - 两轮都失败 → 最终标记为 failed

4. **输入限制**:
   - ModelScope 默认限制为 30000 字符
   - 如果文档很长，系统会自动截断

## 启动验证

配置完成后：

```bash
# 启动服务
npm run dev

# 检查日志确认模型配置
# 应该看到类似：
# [ModelScope] Reading file: ..., Model: Qwen/Qwen3-235B-Instruct
```

## 常见问题

### Q: 如何切换为其他 ModelScope 模型？

A: 修改 `LLM_MODEL` 和 `LLM_FALLBACK_MODEL`，例如：
- `deepseek-ai/DeepSeek-V3`
- `Qwen/Qwen3-30B-Instruct`
- `ZhipuAI/glm-4-9b`

### Q: 可以混合使用 Gemini 和 ModelScope 吗？

A: 可以！例如：
```bash
LLM_PROVIDER=gemini
LLM_MODEL=gemini-1.5-pro
GEMINI_API_KEY=your_gemini_key

LLM_FALLBACK_PROVIDER=modelscope
LLM_FALLBACK_MODEL=Qwen/Qwen3-235B-Instruct
MODELSCOPE_API_KEY=your_modelscope_key
```

### Q: 如何确认配置生效？

A: 
1. 启动服务
2. 上传一个测试文件
3. 查看任务中心，模型名称应显示为 `Qwen/Qwen3-235B-Instruct`
4. 如果第1轮失败，查看详情应显示第2轮使用 `ZhipuAI/glm-4-plus`
