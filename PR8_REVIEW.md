# PR #8 审查意见：LLM Provider 抽象与 Stub 实现

**PR**：Add LLM Provider abstraction with stub implementation  
**状态**：🔴 **需要修正后重新审查**  
**评分**：62/100（关键问题需修正）

---

## 📋 审查摘要

PR #8 实现了 LLM Provider 的抽象框架和 Stub 实现，但存在以下关键问题：

| 检查项 | 状态 | 说明 |
|--------|------|------|
| Provider 抽象清晰 | 🟡 部分 | Stub 实现完整，但缺少 Provider 接口定义 |
| Stub 默认可用 | ✅ | StubLlmProvider 实现正确 |
| 真实 Provider 可配置 | ❌ | 缺少 ProviderFactory 和真实 Provider 实现 |
| Key 只来自 env | ✅ | 环境变量管理正确 |
| Key 不入库 | ✅ | 数据库中不存储 Key |
| Key 不返回 | ✅ | API 响应中不返回 Key |
| Key 不打印 | ✅ | 日志中不打印 Key |
| 失败码可追踪 | ✅ | error_code/error_message 完整 |
| 失败信息不泄露 | ✅ | 错误信息脱敏处理 |
| 测试脚本完整 | ❌ | 缺少 LLM_PARSE_PROVIDER_TEST.sh |
| 不改变既有行为 | ✅ | PR-4/5/6 行为保持一致 |

---

## 🔴 关键问题（P0 - 必须修正）

### 1. 缺少 Provider 接口定义

**问题**：
- 只有 `StubLlmProvider` 实现，没有 `ILlmProvider` 接口
- 无法支持多个 Provider 的可替换性
- 违反 HLD 中"Provider 接口抽象"的要求

**当前代码**：
```typescript
// src/services/StubLlmProvider.ts
export class StubLlmProvider {
  async parse(request: StubParseRequest): Promise<StubParseResult> { ... }
}
```

**应该改为**：
```typescript
// src/services/ILlmProvider.ts
export interface ILlmProvider {
  parse(request: ParseRequest): Promise<ParseResult>;
  getName(): string;
  getModel(): string;
}

// src/services/StubLlmProvider.ts
export class StubLlmProvider implements ILlmProvider {
  async parse(request: ParseRequest): Promise<ParseResult> { ... }
  getName(): string { return 'stub'; }
  getModel(): string { return 'stub-v1'; }
}
```

**影响**：
- 后续无法轻松添加 GeminiProvider、OpenAIProvider 等
- 代码耦合度高，难以维护

**修正工作量**：30 分钟

---

### 2. 缺少 ProviderFactory

**问题**：
- `LlmJobRunner` 中硬编码使用 `stubLlmProvider`
- 无法根据环境变量 `LLM_PROVIDER` 切换 Provider
- 违反 HLD 第 5.2 章"ProviderFactory"的要求

**当前代码**：
```typescript
// src/services/LlmJobRunner.ts
const parseResult = await stubLlmProvider.parse({...});
```

**应该改为**：
```typescript
// src/services/ProviderFactory.ts
export class ProviderFactory {
  static getProvider(): ILlmProvider {
    const provider = process.env.LLM_PROVIDER || 'stub';
    switch (provider) {
      case 'gemini':
        return new GeminiProvider();
      case 'stub':
      default:
        return new StubLlmProvider();
    }
  }
}

// src/services/LlmJobRunner.ts
const provider = ProviderFactory.getProvider();
const parseResult = await provider.parse({...});
```

**影响**：
- 无法在生产环境切换到真实 Provider
- 测试无法验证 Provider 可配置性

**修正工作量**：30 分钟

---

### 3. 缺少 LLM_PARSE_PROVIDER_TEST.sh 验收脚本

**问题**：
- ACCEPTANCE 要求"LLM_PARSE_PROVIDER_TEST.sh stub/real 两模式均通过"
- 当前没有提供验收脚本
- 无法验证 Provider 抽象的正确性

**应该添加**：
```bash
#!/bin/bash
# LLM_PARSE_PROVIDER_TEST.sh

set -e

echo "=== LLM Provider 抽象验收测试 ==="

# 1. Stub 模式测试
echo "1️⃣ 测试 Stub Provider..."
export LLM_PROVIDER=stub
npm run dev:llm &
BACKEND_PID=$!
sleep 2

# 创建城市
REGION_ID=$(curl -s -X POST http://localhost:3000/api/regions \
  -H "Content-Type: application/json" \
  -d '{"code":"test","name":"测试","province":"测试"}' | jq -r '.id')

# 上传报告
UPLOAD=$(curl -s -X POST http://localhost:3000/api/reports \
  -F "region_id=$REGION_ID" -F "year=2024" -F "file=@sample.pdf")
JOB_ID=$(echo $UPLOAD | jq -r '.job_id')

# 轮询 Job 直到完成
for i in {1..30}; do
  JOB=$(curl -s http://localhost:3000/api/jobs/$JOB_ID)
  STATUS=$(echo $JOB | jq -r '.status')
  if [ "$STATUS" = "succeeded" ]; then
    echo "✅ Stub Provider 解析成功"
    break
  fi
  sleep 1
done

kill $BACKEND_PID

# 2. 验证 Provider 字段
echo "2️⃣ 验证 Provider 字段..."
REPORT=$(curl -s http://localhost:3000/api/reports/$REGION_ID)
PROVIDER=$(echo $REPORT | jq -r '.active_version.provider')
if [ "$PROVIDER" = "stub-llm" ]; then
  echo "✅ Provider 字段正确: $PROVIDER"
else
  echo "❌ Provider 字段错误: $PROVIDER"
  exit 1
fi

# 3. 验证 Model 字段
MODEL=$(echo $REPORT | jq -r '.active_version.model')
if [ "$MODEL" = "stub-v1" ]; then
  echo "✅ Model 字段正确: $MODEL"
else
  echo "❌ Model 字段错误: $MODEL"
  exit 1
fi

echo "✅ LLM Provider 抽象验收通过"
```

**修正工作量**：1 小时

---

## 🟡 中等问题（P1 - 应该修正）

### 4. 错误处理中的敏感信息泄露风险

**问题**：
```typescript
// src/services/LlmJobRunner.ts
catch (error: any) {
  const message = typeof error?.message === 'string' ? error.message : 'unknown_error';
  querySqlite(
    `UPDATE jobs SET status = 'failed', error_code = 'STUB_PARSE_FAILED', 
     error_message = ${sqlValue(message)}, ...`
  );
  console.error(`LLM job ${job.id} failed:`, error);  // ⚠️ 可能泄露敏感信息
}
```

**风险**：
- `error` 对象可能包含文件路径、API 响应等敏感信息
- `console.error` 会打印完整的 error stack

**应该改为**：
```typescript
catch (error: any) {
  // 脱敏错误信息
  let errorCode = 'PARSE_FAILED';
  let errorMessage = 'Parse failed';
  
  if (error?.message?.includes('file not found')) {
    errorCode = 'FILE_NOT_FOUND';
    errorMessage = 'File not found';
  } else if (error?.message?.includes('timeout')) {
    errorCode = 'TIMEOUT';
    errorMessage = 'Parse timeout';
  }
  
  querySqlite(
    `UPDATE jobs SET status = 'failed', error_code = ${sqlValue(errorCode)}, 
     error_message = ${sqlValue(errorMessage)}, ...`
  );
  
  // 仅记录脱敏后的错误
  console.error(`LLM job ${job.id} failed: ${errorCode}`);
}
```

**修正工作量**：30 分钟

---

### 5. 缺少 Provider 配置文档

**问题**：
- 没有说明如何配置不同的 Provider
- 没有说明 `LLM_PROVIDER` 环境变量的取值
- 没有说明如何添加新的 Provider

**应该添加**：
```markdown
# Provider 配置指南

## 环境变量

### LLM_PROVIDER
- 取值：`stub` | `gemini` | `openai`
- 默认值：`stub`
- 说明：选择使用的 LLM Provider

### Stub Provider（本地测试）
```bash
export LLM_PROVIDER=stub
npm run dev:llm
```

### Gemini Provider（生产）
```bash
export LLM_PROVIDER=gemini
export GEMINI_API_KEY=***
export GEMINI_MODEL=gemini-2.5-flash
npm run dev:llm
```

## 添加新 Provider

1. 创建 `src/services/YourProvider.ts`
2. 实现 `ILlmProvider` 接口
3. 在 `ProviderFactory` 中注册
```

**修正工作量**：30 分钟

---

## 🟢 良好部分（✅ 通过）

### ✅ Stub Provider 实现正确

```typescript
export class StubLlmProvider {
  async parse(request: StubParseRequest): Promise<StubParseResult> {
    // ✅ 正确读取文件
    await fs.promises.readFile(absolutePath);
    
    // ✅ 正确计算 hash
    const fileHash = request.fileHash || (await calculateFileHash(absolutePath));
    
    // ✅ 返回完整的元数据
    return {
      provider: this.provider,
      model: this.model,
      report_id: request.reportId,
      version_id: request.versionId,
      storage_path: request.storagePath,
      file_hash: fileHash,
      file_size: fileStats.size,
      generated_at: new Date().toISOString(),
    };
  }
}
```

**验证**：✅ 完全符合 HLD 要求

---

### ✅ Key 管理正确

**检查清单**：
- ✅ Key 仅来自环境变量（`process.env.GEMINI_API_KEY`）
- ✅ Key 不入库（数据库中只存 provider/model，不存 key）
- ✅ Key 不返回（API 响应中不包含 key）
- ✅ Key 不打印（日志中不打印 key）

**验证**：
```bash
# 检查源码中是否有硬编码 Key
grep -r "sk-\|AIza\|Bearer" src/ --include="*.ts"
# 结果：无匹配（✅ 通过）

# 检查是否在日志中打印 Key
grep -r "console.*key\|console.*KEY" src/ --include="*.ts"
# 结果：无匹配（✅ 通过）
```

---

### ✅ 数据库设计正确

**检查清单**：
- ✅ `report_versions` 表包含 `provider` 字段
- ✅ `report_versions` 表包含 `model` 字段
- ✅ `report_versions` 表包含 `prompt_version` 字段
- ✅ `jobs` 表包含 `error_code` 字段
- ✅ `jobs` 表包含 `error_message` 字段

**验证**：
```sql
-- SQLite
CREATE TABLE report_versions (
  ...
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  ...
);

CREATE TABLE jobs (
  ...
  error_code TEXT,
  error_message TEXT,
  ...
);
```

✅ 完全符合 HLD 第 3 章

---

### ✅ 不改变既有行为

**检查清单**：
- ✅ PR-4 的 regions API 行为不变
- ✅ PR-5 的 reports upload API 行为不变
- ✅ PR-6 的 reports read API 行为不变
- ✅ 新增 LlmJobRunner 不影响现有 API

**验证**：
- 所有现有路由文件未修改
- 新增文件：`StubLlmProvider.ts`、`LlmJobRunner.ts`
- 修改文件：`index-llm.ts`（仅添加 llmJobRunner.start()）

✅ 完全符合要求

---

## 📊 详细检查结果

### 1. Provider 抽象清晰度

| 检查项 | 当前 | 要求 | 状态 |
|--------|------|------|------|
| ILlmProvider 接口 | ❌ 无 | ✅ 有 | 🔴 缺失 |
| StubLlmProvider 实现 | ✅ 有 | ✅ 有 | ✅ 通过 |
| ProviderFactory | ❌ 无 | ✅ 有 | 🔴 缺失 |
| 环境变量配置 | ✅ 有 | ✅ 有 | ✅ 通过 |

---

### 2. Key 安全性

| 检查项 | 当前 | 要求 | 状态 |
|--------|------|------|------|
| Key 来自 env | ✅ 是 | ✅ 是 | ✅ 通过 |
| Key 不入库 | ✅ 是 | ✅ 是 | ✅ 通过 |
| Key 不返回 | ✅ 是 | ✅ 是 | ✅ 通过 |
| Key 不打印 | ✅ 是 | ✅ 是 | ✅ 通过 |
| 前端不含 Key | ✅ 是 | ✅ 是 | ✅ 通过 |

---

### 3. 错误处理

| 检查项 | 当前 | 要求 | 状态 |
|--------|------|------|------|
| error_code 记录 | ✅ 有 | ✅ 有 | ✅ 通过 |
| error_message 记录 | ✅ 有 | ✅ 有 | ✅ 通过 |
| 错误信息脱敏 | 🟡 部分 | ✅ 完全 | 🟡 需改进 |
| 日志不泄露敏感信息 | 🟡 部分 | ✅ 完全 | 🟡 需改进 |

---

### 4. 测试覆盖

| 检查项 | 当前 | 要求 | 状态 |
|--------|------|------|------|
| Stub 模式测试 | ❌ 无 | ✅ 有 | 🔴 缺失 |
| Real 模式测试 | ❌ 无 | ✅ 有 | 🔴 缺失 |
| Provider 切换测试 | ❌ 无 | ✅ 有 | 🔴 缺失 |
| 验收脚本 | ❌ 无 | ✅ 有 | 🔴 缺失 |

---

## 🔧 修正清单

### P0（必须修正）

- [ ] **添加 ILlmProvider 接口**
  - 文件：`src/services/ILlmProvider.ts`
  - 工作量：30 分钟
  - 优先级：🔴 高

- [ ] **添加 ProviderFactory**
  - 文件：`src/services/ProviderFactory.ts`
  - 工作量：30 分钟
  - 优先级：🔴 高

- [ ] **添加 LLM_PARSE_PROVIDER_TEST.sh**
  - 文件：`LLM_PARSE_PROVIDER_TEST.sh`
  - 工作量：1 小时
  - 优先级：🔴 高

### P1（应该修正）

- [ ] **改进错误处理中的敏感信息脱敏**
  - 文件：`src/services/LlmJobRunner.ts`
  - 工作量：30 分钟
  - 优先级：🟡 中

- [ ] **添加 Provider 配置文档**
  - 文件：`PROVIDER_CONFIG.md`
  - 工作量：30 分钟
  - 优先级：🟡 中

---

## ✅ 修正后的预期状态

修正完成后，应满足以下标准：

- ✅ Provider 接口清晰，支持多个实现
- ✅ ProviderFactory 可根据环境变量切换 Provider
- ✅ Stub Provider 作为默认实现，可用于本地测试
- ✅ 真实 Provider（Gemini）可配置，用于生产
- ✅ Key 管理安全，不泄露敏感信息
- ✅ 错误处理完善，错误信息脱敏
- ✅ 验收脚本完整，stub/real 两模式均通过
- ✅ 不改变 PR-4/5/6 的既有行为

---

## 📝 修正建议

### 第一步：添加 Provider 接口（30 分钟）

```typescript
// src/services/ILlmProvider.ts
export interface ParseRequest {
  reportId: number;
  versionId: number;
  storagePath: string;
  fileHash?: string;
}

export interface ParseResult {
  provider: string;
  model: string;
  report_id: number;
  version_id: number;
  storage_path: string;
  file_hash: string;
  file_size: number;
  generated_at: string;
}

export interface ILlmProvider {
  parse(request: ParseRequest): Promise<ParseResult>;
  getName(): string;
  getModel(): string;
}
```

### 第二步：添加 ProviderFactory（30 分钟）

```typescript
// src/services/ProviderFactory.ts
import { ILlmProvider } from './ILlmProvider';
import { StubLlmProvider } from './StubLlmProvider';

export class ProviderFactory {
  static getProvider(): ILlmProvider {
    const provider = process.env.LLM_PROVIDER || 'stub';
    
    switch (provider) {
      case 'gemini':
        // TODO: 实现 GeminiProvider
        throw new Error('GeminiProvider not yet implemented');
      case 'stub':
      default:
        return new StubLlmProvider();
    }
  }
}
```

### 第三步：更新 LlmJobRunner（15 分钟）

```typescript
// src/services/LlmJobRunner.ts
import { ProviderFactory } from './ProviderFactory';

// 在 processJob 中
const provider = ProviderFactory.getProvider();
const parseResult = await provider.parse({...});
```

### 第四步：添加验收脚本（1 小时）

创建 `LLM_PARSE_PROVIDER_TEST.sh`，包含：
- Stub 模式启动和测试
- 验证 provider/model 字段
- 验证错误处理
- 验证幂等性

---

## 🎯 最终结论

**当前状态**：🔴 **需要修正后重新审查**

**关键问题**：
1. 缺少 Provider 接口定义（P0）
2. 缺少 ProviderFactory（P0）
3. 缺少验收脚本（P0）
4. 错误处理需改进（P1）

**建议**：
1. 立即修正 P0 问题（预计 2 小时）
2. 修正 P1 问题（预计 1 小时）
3. 重新提交 PR 进行审查

**修正后预期评分**：95/100

---

**审查完成**：2025-12-17  
**审查人**：Kiro  
**状态**：🔴 需要修正

