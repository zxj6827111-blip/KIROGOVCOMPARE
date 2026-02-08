import fs from 'fs';
import path from 'path';
import { calculateFileHash } from '../utils/fileHash';
import { LlmParseRequest, LlmParseResult, LlmProvider } from './LlmProvider';
import { loadUserText } from './LlmCommon';
import PdfParseService from './PdfParseService';

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

    const loaded = await loadUserText(absolutePath, request);
    const sourceText = loaded.text || '';
    const lowerPath = absolutePath.toLowerCase();

    let sections: any[] = [];
    let pageCount = 0;
    if (lowerPath.endsWith('.pdf')) {
      const parsed = await PdfParseService.parsePDF(absolutePath, String(request.reportId));
      if (parsed.success) {
        sections = parsed.document?.sections ?? [];
        pageCount = (parsed.document?.metadata?.totalPages ?? 0) || 0;
      }
    }

    const preprocessingFailed = /^.*(parse failed|threw exception|Unsupported file extension|read failed).*$/i.test(sourceText);
    const now = new Date().toISOString();
    const output = {
      report_id: request.reportId,
      version_id: request.versionId,
      storage_path: request.storagePath,
      file_hash: fileHash,
      file_size: fileStats.size,
      generated_at: now,
      summary: preprocessingFailed
        ? '本地预处理失败（stub），仅写入文件元信息。'
        : `已完成本地预处理（stub），格式：${loaded.metadata.format || 'unknown'}，长度：${sourceText.length}。${pageCount > 0 ? ` 页数：${pageCount}。` : ''}`,
      source_format: loaded.metadata.format || null,
      sections,
    };

    return {
      provider: this.provider,
      model: this.model,
      output,
      sourceText,
    };
  }
}

export const stubLlmProvider = new StubLlmProvider();
