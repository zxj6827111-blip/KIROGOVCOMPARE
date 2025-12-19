import axios, { AxiosError } from 'axios';
import fs from 'fs';
import path from 'path';
import { calculateFileHash } from '../utils/fileHash';
import { normalizeParsedReport, buildTable3Skeleton, buildActiveDisclosureSkeleton, buildReviewLitigationSkeleton } from '../utils/normalizeParsedReport';
import { LlmParseRequest, LlmParseResult, LlmProvider, LlmProviderError } from './LlmProvider';
import PdfParseService from './PdfParseService';

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

function stripMarkdownJsonFences(text: string): string {
  return String(text || '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
}

function extractFirstJsonObject(text: string): any {
  const stripped = stripMarkdownJsonFences(text);
  try {
    return JSON.parse(stripped);
  } catch (error) {
    /* fallthrough */
  }

  const start = stripped.indexOf('{');
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < stripped.length; i += 1) {
      const ch = stripped[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
      } else if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = stripped.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch (error) {
            break;
          }
        }
      }
    }
  }

  const snippet = stripped.slice(0, 800);
  throw new LlmProviderError(`Gemini returned non-JSON content: ${snippet}`, 'gemini_invalid_json');
}

function buildSystemInstruction(): string {
  const table3 = buildTable3Skeleton();
  const activeDisclosure = buildActiveDisclosureSkeleton();
  const reviewLitigation = buildReviewLitigationSkeleton();
  const system = [
    'You are a professional assistant for extracting structured data from Chinese Government Information Disclosure Annual Reports (政府信息公开工作年度报告).',
    'Your task is to analyze the OCR text provided by the user and return a JSON object representing the FULL document structure.',
    '',
    'CRITICAL RULE: Return ONLY valid JSON. No markdown formatting.',
    '',
    'SECTIONS TO EXTRACT:',
    '1. Overall Situation (一、总体情况) -> type: "text"',
    '2. Active Disclosure (二、主动公开政府信息情况) -> type: "table_2"',
    '3. Received and Processed Requests (三、收到和处理政府信息公开申请情况) -> type: "table_3"',
    '4. Administrative Review/Litigation (四、政府信息公开行政复议、行政诉讼情况) -> type: "table_4"',
    '5. Problems and Improvements (五、存在的主要问题及改进情况) -> type: "text"',
    '6. Other Matters (六、其他需要报告的事项) -> type: "text"',
    '',
    'Active Disclosure (table_2) extract into activeDisclosureData:',
    JSON.stringify(activeDisclosure, null, 2),
    '',
    'CRITICAL for table_3:',
    '- You MUST extract it into tableData with the EXACT structure below.',
    '- Use 0 for blank or missing numbers.',
    '- Do NOT omit any keys.',
    JSON.stringify(table3, null, 2),
    '',
    'Administrative Review/Litigation (table_4) extract into reviewLitigationData:',
    JSON.stringify(reviewLitigation, null, 2),
    '',
    'OUTPUT FORMAT (Return ONLY JSON):',
    JSON.stringify(
      {
        sections: [
          { title: '一、总体情况', type: 'text', content: '...' },
          { title: '二、主动公开政府信息情况', type: 'table_2', activeDisclosureData: {} },
          { title: '三、收到和处理政府信息公开申请情况', type: 'table_3', tableData: table3 },
          { title: '四、政府信息公开行政复议、行政诉讼情况', type: 'table_4', reviewLitigationData: {} },
          { title: '五、存在的主要问题及改进情况', type: 'text', content: '...' },
          { title: '六、其他需要报告的事项', type: 'text', content: '...' },
        ],
      },
      null,
      2
    ),
  ].join('\n');

  return system;
}

async function loadUserText(absolutePath: string, request: LlmParseRequest): Promise<string> {
  const lower = absolutePath.toLowerCase();

  if (lower.endsWith('.pdf')) {
    const parsed = await PdfParseService.parsePDF(absolutePath, String(request.reportId));
    if (parsed.success && parsed.document?.extracted_text) {
      return parsed.document.extracted_text;
    }
    return `PDF parse failed. File metadata: ${JSON.stringify(request)}`;
  }

  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.json')) {
    try {
      return fs.readFileSync(absolutePath, 'utf-8');
    } catch (error) {
      return `Text read failed. File metadata: ${JSON.stringify(request)}`;
    }
  }

  return `Unsupported file extension. File metadata: ${JSON.stringify(request)}`;
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

    const systemInstructionText = buildSystemInstruction();
    let userText = await loadUserText(absolutePath, request);

    const maxChars = Number(process.env.GEMINI_INPUT_MAX_CHARS || 120000);
    if (Number.isFinite(maxChars) && maxChars > 1000 && userText.length > maxChars) {
      userText = userText.slice(0, maxChars);
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;

    const timeout = Number(process.env.GEMINI_TIMEOUT_MS || 120000);

    try {
      const response = await axios.post<GeminiResponse>(
        url,
        {
          contents: [
            {
              role: 'user',
              parts: [{ text: userText }],
            },
          ],
          system_instruction: {
            parts: [{ text: systemInstructionText }],
          },
          systemInstruction: {
            parts: [{ text: systemInstructionText }],
          },
          generationConfig: {
            responseMimeType: 'application/json',
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          timeout,
        }
      );

      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new LlmProviderError('Gemini response missing content', 'gemini_empty_response');
      }

      let parsed: any;
      try {
        parsed = extractFirstJsonObject(text);
      } catch (error) {
        if (error instanceof LlmProviderError) {
          throw error;
        }
        const snippet = stripMarkdownJsonFences(text).slice(0, 800);
        throw new LlmProviderError(`Gemini returned invalid JSON: ${snippet}`, 'gemini_invalid_json');
      }

      const normalized = normalizeParsedReport(parsed);

      const output = {
        report_id: request.reportId,
        version_id: request.versionId,
        storage_path: request.storagePath,
        file_hash: fileHash,
        file_size: fileStats.size,
        generated_at: new Date().toISOString(),
        ...normalized,
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
      if (axiosError?.code === 'ECONNABORTED') {
        throw new LlmProviderError(`Gemini request timed out after ${timeout}ms`, 'gemini_timeout');
      }

      if (axiosError?.response) {
        const status = axiosError.response.status;
        const statusText = axiosError.response.statusText || 'unknown_error';
        const data = axiosError.response.data;
        const body = typeof data === 'string' ? data : JSON.stringify(data);
        const truncated = body ? body.slice(0, 1200) : '';
        const geminiMessage = (axiosError.response.data as any)?.error?.message;
        const detail = geminiMessage ? ` - ${geminiMessage}` : '';
        throw new LlmProviderError(
          `Gemini request failed with status ${status}: ${statusText}${detail}. Response: ${truncated}`,
          'gemini_http_error'
        );
      }

      const message = axiosError?.message || 'Gemini request failed';
      throw new LlmProviderError(message, 'gemini_request_error');
    }
  }
}
