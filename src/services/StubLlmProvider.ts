import fs from 'fs';
import path from 'path';
import { calculateFileHash } from '../utils/fileHash';
import { LlmParseRequest, LlmParseResult, LlmProvider } from './LlmProvider';

export class StubLlmProvider implements LlmProvider {
  private readonly provider = 'stub-llm';
  private readonly model = 'stub-v1';

  async parse(request: LlmParseRequest): Promise<LlmParseResult> {
    const absolutePath = path.isAbsolute(request.storagePath)
      ? request.storagePath
      : path.join(process.cwd(), request.storagePath);

    await fs.promises.readFile(absolutePath);
    const fileStats = await fs.promises.stat(absolutePath);
    const fileHash = request.fileHash || (await calculateFileHash(absolutePath));

    const output = {
      report_id: request.reportId,
      version_id: request.versionId,
      storage_path: request.storagePath,
      file_hash: fileHash,
      file_size: fileStats.size,
      generated_at: new Date().toISOString(),
    };

    return {
      provider: this.provider,
      model: this.model,
      output,
    };
  }
}

export const stubLlmProvider = new StubLlmProvider();
