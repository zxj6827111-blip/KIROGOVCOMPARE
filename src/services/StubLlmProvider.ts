import fs from 'fs';
import path from 'path';
import { calculateFileHash } from '../utils/fileHash';

export interface StubParseRequest {
  reportId: number;
  versionId: number;
  storagePath: string;
  fileHash?: string;
}

export interface StubParseResult {
  provider: string;
  model: string;
  report_id: number;
  version_id: number;
  storage_path: string;
  file_hash: string;
  file_size: number;
  generated_at: string;
}

export class StubLlmProvider {
  private readonly provider = 'stub-llm';
  private readonly model = 'stub-v1';

  async parse(request: StubParseRequest): Promise<StubParseResult> {
    const absolutePath = path.isAbsolute(request.storagePath)
      ? request.storagePath
      : path.join(process.cwd(), request.storagePath);

    await fs.promises.readFile(absolutePath);
    const fileStats = await fs.promises.stat(absolutePath);
    const fileHash = request.fileHash || (await calculateFileHash(absolutePath));

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

export const stubLlmProvider = new StubLlmProvider();
