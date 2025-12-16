import axios, { AxiosError } from 'axios';
import fs from 'fs';
import path from 'path';
import { calculateFileHash } from '../utils/fileHash';
import { LlmParseRequest, LlmParseResult, LlmProvider, LlmProviderError } from './LlmProvider';

interface GeminiCandidateContent {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

export class GeminiLlmProvider implements LlmProvider {
  private readonly provider = 'gemini';

  constructor(private readonly apiKey: string, private readonly model: string) {}

  async parse(request: LlmParseRequest): Promise<LlmParseResult> {
    const absolutePath = path.isAbsolute(request.storagePath)
      ? request.storagePath
      : path.join(process.cwd(), request.storagePath);

    const fileStats = await fs.promises.stat(absolutePath);
    const fileHash = request.fileHash || (await calculateFileHash(absolutePath));

    const prompt = [
      'You are assisting with extracting metadata for a PDF file stored on disk.',
      'Only use the provided metadata to produce a concise JSON object.',
      'If you cannot infer certain fields, return reasonable placeholders instead of hallucinating unseen content.',
      'Required keys: report_id, version_id, storage_path, file_hash, file_size, generated_at, summary.',
      'Use ISO 8601 for generated_at and keep summary brief.',
      `File metadata => report_id: ${request.reportId}, version_id: ${request.versionId}, storage_path: ${request.storagePath}, file_hash: ${fileHash}, file_size: ${fileStats.size} bytes.`,
    ].join('\n');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;

    try {
      const response = await axios.post<GeminiCandidateContent>(
        url,
        {
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
          },
        },
        {
          params: { key: this.apiKey },
          headers: { 'Content-Type': 'application/json' },
          timeout: 20000,
        }
      );

      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new LlmProviderError('Gemini response missing content', 'gemini_empty_response');
      }

      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        parsed = { raw_text: text };
      }

      const output = {
        report_id: request.reportId,
        version_id: request.versionId,
        storage_path: request.storagePath,
        file_hash: fileHash,
        file_size: fileStats.size,
        generated_at: new Date().toISOString(),
        ...parsed,
      };

      return {
        provider: this.provider,
        model: this.model,
        output,
      };
    } catch (error) {
      if (error instanceof LlmProviderError) {
        throw error;
      }

      const axiosError = error as AxiosError;
      if (axiosError?.response) {
        const status = axiosError.response.status;
        const statusText = axiosError.response.statusText || 'unknown_error';
        throw new LlmProviderError(`Gemini request failed with status ${status}: ${statusText}`, 'gemini_http_error');
      }

      const message = axiosError?.message || 'Gemini request failed';
      throw new LlmProviderError(message, 'gemini_request_error');
    }
  }
}
