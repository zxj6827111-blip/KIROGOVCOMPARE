# PR #8 修正指南

## 修正步骤

### 步骤 1：添加 ILlmProvider 接口

创建 `src/services/ILlmProvider.ts`：

```typescript
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

### 步骤 2：添加 ProviderFactory

创建 `src/services/ProviderFactory.ts`：

```typescript
import { ILlmProvider } from './ILlmProvider';
import { StubLlmProvider } from './StubLlmProvider';

export class ProviderFactory {
  static getProvider(): ILlmProvider {
    const provider = process.env.LLM_PROVIDER || 'stub';
    
    switch (provider) {
      case 'gemini':
        throw new Error('GeminiProvider not yet implemented');
      case 'stub':
      default:
        return new StubLlmProvider();
    }
  }
}
```

### 步骤 3：更新 StubLlmProvider

修改 `src/services/StubLlmProvider.ts`：

```typescript
import { ILlmProvider, ParseRequest, ParseResult } from './ILlmProvider';

export class StubLlmProvider implements ILlmProvider {
  private readonly provider = 'stub-llm';
  private readonly model = 'stub-v1';

  async parse(request: ParseRequest): Promise<ParseResult> {
    // ... 现有实现
  }

  getName(): string {
    return this.provider;
  }

  getModel(): string {
    return this.model;
  }
}
```

### 步骤 4：更新 LlmJobRunner

修改 `src/services/LlmJobRunner.ts`：

```typescript
import { ProviderFactory } from './ProviderFactory';

private async processJob(job: QueuedJob): Promise<void> {
  try {
    const provider = ProviderFactory.getProvider();
    const parseResult = await provider.parse({
      reportId: job.report_id,
      versionId: job.version_id,
      storagePath: job.storage_path,
      fileHash: job.file_hash,
    });
    // ... 后续处理
  } catch (error: any) {
    // 脱敏错误信息
    let errorCode = 'PARSE_FAILED';
    let errorMessage = 'Parse failed';
    
    if (error?.message?.includes('file not found')) {
      errorCode = 'FILE_NOT_FOUND';
      errorMessage = 'File not found';
    }
    
    querySqlite(
      `UPDATE jobs SET status = 'failed', error_code = ${sqlValue(errorCode)}, 
       error_message = ${sqlValue(errorMessage)}, finished_at = datetime('now') 
       WHERE id = ${sqlValue(job.id)};`
    );
    
    console.error(`LLM job ${job.id} failed: ${errorCode}`);
  }
}
```

### 步骤 5：添加验收脚本

创建 `LLM_PARSE_PROVIDER_TEST.sh`（见下一个文件）

