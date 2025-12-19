import axios, { AxiosError } from 'axios';
import fs from 'fs';
import path from 'path';
import { calculateFileHash } from '../utils/fileHash';
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

function buildTable3Skeleton(): any {
  const results = {
    granted: 0,
    partialGrant: 0,
    denied: {
      stateSecret: 0,
      lawForbidden: 0,
      safetyStability: 0,
      thirdPartyRights: 0,
      internalAffairs: 0,
      processInfo: 0,
      enforcementCase: 0,
      adminQuery: 0,
    },
    unableToProvide: {
      noInfo: 0,
      needCreation: 0,
      unclear: 0,
    },
    notProcessed: {
      complaint: 0,
      repeat: 0,
      publication: 0,
      massiveRequests: 0,
      confirmInfo: 0,
    },
    other: {
      overdueCorrection: 0,
      overdueFee: 0,
      otherReasons: 0,
    },
    totalProcessed: 0,
    carriedForward: 0,
  };

  const entity = () => ({ newReceived: 0, carriedOver: 0, results: JSON.parse(JSON.stringify(results)) });

  return {
    naturalPerson: entity(),
    legalPerson: {
      commercial: entity(),
      research: entity(),
      social: entity(),
      legal: entity(),
      other: entity(),
    },
    total: entity(),
  };
}

function buildSystemInstruction(): string {
  const table3 = buildTable3Skeleton();
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
    JSON.stringify(
      {
        regulations: { made: 0, repealed: 0, valid: 0 },
        normativeDocuments: { made: 0, repealed: 0, valid: 0 },
        licensing: { processed: 0 },
        punishment: { processed: 0 },
        coercion: { processed: 0 },
        fees: { amount: 0 },
      },
      null,
      2
    ),
    '',
    'CRITICAL for table_3:',
    '- You MUST extract it into tableData with the EXACT structure below.',
    '- Use 0 for blank or missing numbers.',
    '- Do NOT omit any keys.',
    JSON.stringify(table3, null, 2),
    '',
    'Administrative Review/Litigation (table_4) extract into reviewLitigationData:',
    JSON.stringify(
      {
        review: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
        litigationDirect: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
        litigationPostReview: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
      },
      null,
      2
    ),
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
          systemInstruction: {
            parts: [{ text: systemInstructionText }],
          },
          generationConfig: {
            responseMimeType: 'application/json',
          },
        },
        {
          params: { key: this.apiKey },
          headers: { 'Content-Type': 'application/json' },
          timeout: 60000,
        }
      );

      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new LlmProviderError('Gemini response missing content', 'gemini_empty_response');
      }

      let parsed: any;
      try {
        parsed = JSON.parse(stripMarkdownJsonFences(text));
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
