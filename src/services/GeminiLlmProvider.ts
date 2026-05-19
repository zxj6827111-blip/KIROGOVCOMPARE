import fs from 'fs';
import path from 'path';
import { Dispatcher, fetch as undiciFetch } from 'undici';
import { calculateFileHash } from '../utils/fileHash';
import { getProxyDispatcher, resolveProxyUrl, sanitizeProxyUrlForLog } from '../utils/httpProxy';
import { LlmParseRequest, LlmParseResult, LlmProvider, LlmProviderError } from './LlmProvider';
import PdfParseService from './PdfParseService';
import HtmlParseService from './HtmlParseService';

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

const GEMINI_DEBUG_LOGS = process.env.LLM_DEBUG_LOGS === '1';

function stripMarkdownJsonFences(text: string): string {
  return String(text || '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
}

function resolveGeminiBaseUrl(): string {
  const baseUrl = String(process.env.GEMINI_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new LlmProviderError('GEMINI_BASE_URL is required for Gemini provider', 'gemini_missing_base_url');
  }
  return baseUrl;
}

/**
 * 清理 Markdown 标题符号（#, ##, ###等）和表格分隔符
 * 在 LLM 解析后调用，用于清理最终存入数据库的文本内容
 */
function cleanMarkdownSymbols(text: string): string {
  if (!text || typeof text !== 'string') return text;

  return text
    // 移除标题符号 # ## ### #### 等（保留标题文字）
    .replace(/^#{1,6}\s+/gm, '')
    // 移除 Markdown 表格分隔行 |---|---|
    .replace(/^\|[-:\s|]+\|$/gm, '')
    // 清理表格行首尾的 | 符号（可选，取决于您希望的最终格式）
    // .replace(/^\|\s*/gm, '').replace(/\s*\|$/gm, '')
    .trim();
}

/**
 * 递归清理解析结果中所有文本字段的 Markdown 符号
 */
function cleanParsedResult(obj: any): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return cleanMarkdownSymbols(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => cleanParsedResult(item));
  }

  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      // 如果字段名匹配目标，则强制进行清理（字符串会被清理，对象会递归）
      if (key === 'content' || key === 'title' || key === 'text' || key === 'raw_text') {
        cleaned[key] = cleanParsedResult(value);
      } else {
        // 如果字段名不匹配，但值是对象或数组，仍需递归查找内部的目标字段
        if (typeof value === 'object' && value !== null) {
          cleaned[key] = cleanParsedResult(value);
        } else {
          // 其他基本类型（数字、布尔值、非目标字段的字符串）保持不变
          cleaned[key] = value;
        }
      }
    }
    return cleaned;
  }

  return obj;
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
    'Your task is to analyze the text/Markdown provided by the user and return a JSON object representing the FULL document structure.',
    '',
    'CRITICAL RULE: Return ONLY valid JSON. No markdown formatting.',
    '',
    '=== INPUT FORMAT RECOGNITION ===',
    'The input may contain:',
    '1. Markdown tables with | separators (e.g., | 项目 | 数值 |)',
    '2. Section headers like "## 表二：..." or "### 行政复议"',
    '3. Table type identifiers like "[TABLE_2]", "表三：", etc.',
    '',
    'For TABLE_4 (行政复议、行政诉讼情况), the input may be SPLIT into 3 separate sub-tables:',
    '- ### 行政复议 (5 columns: 结果维持, 结果纠正, 其他结果, 尚未审结, 总计)',
    '- ### 行政诉讼（未经复议直接起诉）(5 columns)',
    '- ### 行政诉讼（复议后起诉）(5 columns)',
    'You MUST recognize this split format and correctly map to reviewLitigationData.',
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
    '=== CRITICAL DATA EXTRACTION RULES ===',
    'For ALL table cells (table_2, table_3, table_4):',
    '1. If a cell contains a NUMBER, extract it as a number (integer).',
    '2. If a cell contains "/" or "-" or "—" or "空", extract it AS THE STRING "/" or "-" or "空". DO NOT convert to 0.',
    '3. If a cell is BLANK or EMPTY, extract it as null or empty string "". DO NOT convert to 0.',
    '4. Only use 0 when the cell explicitly shows "0".',
    '',
    'This is CRITICAL for data quality auditing. We need to distinguish between:',
    '- A cell that explicitly has value 0',
    '- A cell that is blank/empty (represents missing data)',
    '- A cell that contains "/" or "-" or "空" (represents not applicable)',
    '',
    '=== TABLE_3 STRUCTURE (申请情况表) ===',
    'Look for keywords: 本年新收, 上年结转, 予以公开, 部分公开, 不予公开, 自然人, 法人/其他组织',
    'Column headers typically: 项目 | 自然人 | 商业企业 | 科研机构 | 公益组织 | 法律服务机构 | 其他 | 总计',
    'CRITICAL for table_3 (Structure below):',
    JSON.stringify(table3, null, 2),
    '',
    '=== TABLE_4 STRUCTURE (复议诉讼表) ===',
    'This table may appear in TWO formats:',
    '',
    'FORMAT A - Single large table with multi-row headers (complex):',
    '| | 行政复议 | | | | | 行政诉讼 | ... |',
    '',
    'FORMAT B - SPLIT into 3 sub-tables (preferred, easier to parse):',
    '### 行政复议',
    '| 结果维持 | 结果纠正 | 其他结果 | 尚未审结 | 总计 |',
    '| 13 | 1 | 4 | 10 | 28 |',
    '',
    '### 行政诉讼（未经复议直接起诉）',
    '| 结果维持 | 结果纠正 | 其他结果 | 尚未审结 | 总计 |',
    '| 3 | 0 | 2 | 4 | 9 |',
    '',
    '### 行政诉讼（复议后起诉）',
    '| 结果维持 | 结果纠正 | 其他结果 | 尚未审结 | 总计 |',
    '| 2 | 0 | 0 | 0 | 2 |',
    '',
    'FORMAT C - NARRATIVE TEXT (extract totals only):',
    'Example: "行政复议28件、未经复议直接起诉9件、复议后起诉2件"',
    'In this case, extract only the total values:',
    '- review.total = 28',
    '- litigationDirect.total = 9',
    '- litigationPostReview.total = 2',
    'Set other fields (maintain, correct, other, unfinished) to 0 or null if not specified.',
    '',
    'In BOTH cases, extract into reviewLitigationData:',
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
    'MAPPING for table_4:',
    '- "行政复议" section -> review object',
    '- "未经复议直接起诉" section -> litigationDirect object',
    '- "复议后起诉" section -> litigationPostReview object',
    '- 结果维持 -> maintain, 结果纠正 -> correct, 其他结果 -> other, 尚未审结 -> unfinished, 总计 -> total',
    '',
    'For "text" sections (Section 1, 5, 6): Extract the FULL text content VERBATIM. Do not summarize.',
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

interface LoadedContent {
  text: string;
  metadata: {
    visual_border_missing?: boolean;
    format?: string;
  };
}

function parseGeminiJsonText(text: string): any {
  try {
    return JSON.parse(stripMarkdownJsonFences(text));
  } catch {
    return { raw_text: text };
  }
}

function hasStructuredTables(parsed: any): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
  const sectionHit = (type: string) => sections.some((item: any) => item?.type === type);
  return (
    sectionHit('table_2') ||
    sectionHit('table_3') ||
    sectionHit('table_4') ||
    Boolean(parsed.activeDisclosureData) ||
    Boolean(parsed.tableData) ||
    Boolean(parsed.reviewLitigationData)
  );
}

async function loadUserText(absolutePath: string, request: LlmParseRequest): Promise<LoadedContent> {
  const lower = absolutePath.toLowerCase();

  // PDF Handling
  if (lower.endsWith('.pdf')) {
    const parsed = await PdfParseService.parsePDFToMarkdown(absolutePath, String(request.reportId));
    if (parsed.success && parsed.markdown) {
      return {
        text: parsed.markdown,
        metadata: {
          visual_border_missing: parsed.metadata?.visual_border_missing,
          format: 'pdf'
        }
      };
    }
    return { text: `PDF parse failed. File metadata: ${JSON.stringify(request)}`, metadata: {} };
  }

  // HTML Handling
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    const parsed = await HtmlParseService.parseHtmlToMarkdown(absolutePath);
    if (parsed.success && parsed.extracted_text) {
      return {
        text: parsed.extracted_text,
        metadata: {
          visual_border_missing: parsed.metadata?.visual_border_missing,
          format: 'html'
        }
      };
    }
    return { text: `HTML parse failed. File metadata: ${JSON.stringify(request)}`, metadata: {} };
  }

  // Text/Markdown/JSON Handling
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.json')) {
    try {
      const content = fs.readFileSync(absolutePath, 'utf-8');
      return { text: content, metadata: { format: lower.endsWith('.md') ? 'markdown' : 'text' } };
    } catch (error) {
      return { text: `Text read failed. File metadata: ${JSON.stringify(request)}`, metadata: {} };
    }
  }

  return { text: `Unsupported file extension. File metadata: ${JSON.stringify(request)}`, metadata: {} };
}

export class GeminiLlmProvider implements LlmProvider {
  private readonly provider = 'gemini';
  private readonly dispatcher?: Dispatcher;

  constructor(private readonly apiKey: string, private readonly model: string) {
    const proxyUrl = resolveProxyUrl(['GEMINI_PROXY_URL', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY']);
    this.dispatcher = getProxyDispatcher(proxyUrl);
    if (proxyUrl) {
      console.log(`[Gemini] Using proxy ${sanitizeProxyUrlForLog(proxyUrl)}`);
    }
  }

  private buildRequestSignal(signal: AbortSignal | undefined, timeoutMs: number): {
    signal: AbortSignal;
    cleanup: () => void;
    didTimeout: () => boolean;
  } {
    const controller = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    return {
      signal: combinedSignal,
      cleanup: () => clearTimeout(timer),
      didTimeout: () => timedOut,
    };
  }

  private async postGemini<T>(
    url: string,
    payload: unknown,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<T> {
    const requestUrl = new URL(url);
    requestUrl.searchParams.set('key', this.apiKey);

    const { signal: requestSignal, cleanup, didTimeout } = this.buildRequestSignal(signal, timeoutMs);

    try {
      const response = await undiciFetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        dispatcher: this.dispatcher,
        signal: requestSignal,
      });

      const rawText = await response.text();

      if (!response.ok) {
        const preview = rawText.trim().slice(0, 240);
        throw new LlmProviderError(
          `Gemini request failed with status ${response.status}: ${response.statusText}${preview ? ` | ${preview}` : ''}`,
          'gemini_http_error'
        );
      }

      if (!rawText.trim()) {
        throw new LlmProviderError('Gemini response body is empty', 'gemini_empty_response');
      }

      return JSON.parse(rawText) as T;
    } catch (error) {
      if (error instanceof LlmProviderError) {
        throw error;
      }

      if (didTimeout()) {
        throw new LlmProviderError(`Gemini request timed out after ${timeoutMs}ms`, 'gemini_timeout');
      }

      const message = error instanceof Error ? error.message : String(error || 'Gemini request failed');
      throw new LlmProviderError(message, 'gemini_request_error');
    } finally {
      cleanup();
    }
  }

  async parse(request: LlmParseRequest, signal?: AbortSignal): Promise<LlmParseResult> {
    const absolutePath = path.isAbsolute(request.storagePath)
      ? request.storagePath
      : path.join(process.cwd(), request.storagePath);

    const fileStats = await fs.promises.stat(absolutePath);
    const fileHash = request.fileHash || (await calculateFileHash(absolutePath));

    // Improved prompt to handle formatting issues
    const systemInstructionText = buildSystemInstruction() +
      '\nIMPORTANT: For "text" sections (Section 1, 5, 6), you MUST extract the FULL text content from the original document. Do NOT summarize. Do NOT use placeholders like "..." or "Wait for user content". If the text is present in the document, return it verbatim.\n' +
      'IMPORTANT: Preserve special markers exactly. If a cell contains "/", "-", "—", or "空", output the same string. If a cell is blank, output null or "". Only output 0 when the cell explicitly shows "0".';

    // Load content using specialized parsers
    const loaded = await loadUserText(absolutePath, request);
    let userText = loaded.text;
    const visualMetadata = loaded.metadata;

    if (GEMINI_DEBUG_LOGS) {
      console.log(`[Gemini] Reading file: ${absolutePath}, Size: ${fileStats.size}, Extracted Text Length: ${userText.length}`);
    }
    if (visualMetadata.visual_border_missing) {
      console.warn(`[Gemini] Visual Audit Flag: Borders Missing detected in ${absolutePath}`);
    }

    if (GEMINI_DEBUG_LOGS && userText.length < 500) {
      console.log(`[Gemini] DEBUG Content Preview: ${userText}`);
    }

    const maxChars = Number(process.env.GEMINI_INPUT_MAX_CHARS || 1000000);
    if (Number.isFinite(maxChars) && maxChars > 1000 && userText.length > maxChars) {
      if (GEMINI_DEBUG_LOGS) {
        console.log(`[Gemini] Truncating input from ${userText.length} to ${maxChars}`);
      }
      userText = userText.slice(0, maxChars);
    }

    const baseUrl = resolveGeminiBaseUrl();
    const url = `${baseUrl}/v1beta/models/${this.model}:generateContent`;
    const parseTemperatureRaw = Number(process.env.LLM_PARSE_TEMPERATURE ?? 0);
    const parseTemperature = Number.isFinite(parseTemperatureRaw)
      ? Math.max(0, Math.min(1, parseTemperatureRaw))
      : 0;

    try {
      const requestPayload = {
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
          temperature: parseTemperature,
          topP: 1,
        },
      };

      const response = await this.postGemini<GeminiResponse>(url, requestPayload, 300000, signal);

      const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        console.error('[Gemini] Response missing content:', JSON.stringify(response));
        throw new LlmProviderError('Gemini response missing content', 'gemini_empty_response');
      }
      console.log('[Gemini] Raw Response (Preview):', text.slice(0, 500));

      let parsed: any = parseGeminiJsonText(text);

      // Fallback for scanned/low-text PDFs: send original PDF bytes directly to Gemini.
      const isPdf = absolutePath.toLowerCase().endsWith('.pdf');
      const pdfInlineFallbackEnabled = String(process.env.GEMINI_PDF_INLINE_FALLBACK || '1') !== '0';
      const minTextLenForPdf = Number(process.env.GEMINI_PDF_MIN_TEXT_LEN || 200);
      const maxInlinePdfBytes = Number(process.env.GEMINI_INLINE_PDF_MAX_BYTES || 15 * 1024 * 1024);
      const needPdfFallback =
        isPdf &&
        pdfInlineFallbackEnabled &&
        userText.length < minTextLenForPdf &&
        !hasStructuredTables(parsed) &&
        fileStats.size <= maxInlinePdfBytes;

      if (needPdfFallback) {
        console.warn(`[Gemini] Low-text PDF detected. Retrying parse with inline PDF bytes for ${absolutePath}`);
        const pdfBase64 = (await fs.promises.readFile(absolutePath)).toString('base64');
        const inlinePrompt =
          '请直接读取这份 PDF 原文并按系统 JSON Schema 抽取，不要省略表二/表三/表四；只返回 JSON。';

        const inlinePayload = {
          contents: [
            {
              role: 'user',
              parts: [
                { text: inlinePrompt },
                { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
              ],
            },
          ],
          systemInstruction: {
            parts: [{ text: systemInstructionText }],
          },
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: parseTemperature,
            topP: 1,
          },
        };

        const inlineResponse = await this.postGemini<GeminiResponse>(url, inlinePayload, 300000, signal);
        const inlineText = inlineResponse.candidates?.[0]?.content?.parts?.[0]?.text;
        if (inlineText) {
          console.log('[Gemini] Inline PDF Response (Preview):', inlineText.slice(0, 500));
          const inlineParsed = parseGeminiJsonText(inlineText);
          if (hasStructuredTables(inlineParsed)) {
            parsed = inlineParsed;
          }
        }
      }

      // Merge visual metadata into the result
      // IMPORTANT: Code-detected visual issues take priority over AI judgment
      // First spread parsed (AI result), then override/merge visual_audit with code detection
      const output = {
        report_id: request.reportId,
        version_id: request.versionId,
        storage_path: request.storagePath,
        file_hash: fileHash,
        file_size: fileStats.size,
        generated_at: new Date().toISOString(),
        ...parsed,
        // Merge visual_audit: code detection (border_missing) takes priority
        visual_audit: {
          ...(parsed.visual_audit || {}),
          border_missing: !!visualMetadata.visual_border_missing || (parsed.visual_audit?.table_border_missing === true),
          table_border_missing: parsed.visual_audit?.table_border_missing,
          notes: parsed.visual_audit?.notes,
        },
      };

      // 清理 sections 中的 Markdown 符号（#、|---|等）
      if (output.sections && Array.isArray(output.sections)) {
        output.sections = cleanParsedResult(output.sections);
      }

      return {
        provider: this.provider,
        model: this.model,
        output,
        sourceText: userText,
      };
    } catch (error) {
      if (error instanceof LlmProviderError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error || 'Gemini request failed');
      throw new LlmProviderError(message, 'gemini_request_error');
    }
  }

  async generate(prompt: string, systemInstruction?: string, config?: any): Promise<any> {
    const baseUrl = resolveGeminiBaseUrl();
    const url = `${baseUrl}/v1beta/models/${this.model}:generateContent`;
    const thinkingBudget = Number(config?.thinkingBudget || 0);
    const generationConfig: any = {
      responseMimeType: config?.responseMimeType ?? 'application/json',
      responseSchema: config?.responseSchema,
      temperature: config?.temperature,
      maxOutputTokens: config?.maxOutputTokens,
    };
    if (Number.isFinite(thinkingBudget) && thinkingBudget > 0) {
      generationConfig.thinkingConfig = { thinkingBudget: Math.floor(thinkingBudget) };
    }

    try {
      const response = await this.postGemini<GeminiResponse>(
        url,
        {
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          systemInstruction: systemInstruction ? {
            parts: [{ text: systemInstruction }],
          } : undefined,
          generationConfig,
        },
        120000
      );

      const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini response missing content');
      }
      return { text };
    } catch (error) {
      if (error instanceof LlmProviderError) {
        throw error;
      }
      throw error;
    }
  }
}
