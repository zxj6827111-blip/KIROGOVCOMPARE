import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { calculateFileHash } from '../utils/fileHash';
import { LlmParseRequest, LlmParseResult, LlmProvider, LlmProviderError } from './LlmProvider';
import {
  buildStrictParseSystemInstruction,
  loadUserText,
  stripMarkdownJsonFences,
} from './LlmCommon';

interface OpenAIResponse {
  id?: string;
  choices?: Array<{
    index?: number;
    message?: {
      role?: string;
      content?: unknown;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface GenerateConfig {
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;
  [key: string]: unknown;
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const chunks = content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (!part || typeof part !== 'object') {
          return '';
        }

        const p = part as Record<string, unknown>;
        if (typeof p.text === 'string') {
          return p.text;
        }
        if (typeof p.content === 'string') {
          return p.content;
        }
        return '';
      })
      .filter(Boolean);

    return chunks.join('\n').trim();
  }

  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    if (typeof obj.text === 'string') {
      return obj.text.trim();
    }
    if (typeof obj.content === 'string') {
      return obj.content.trim();
    }
  }

  return '';
}

export class NvidiaLlmProvider implements LlmProvider {
  private readonly provider = 'nvidia';
  private readonly baseUrl = 'https://integrate.api.nvidia.com/v1';

  constructor(private readonly apiKey: string, private readonly model: string) {}

  async parse(request: LlmParseRequest, signal?: AbortSignal): Promise<LlmParseResult> {
    const absolutePath = path.isAbsolute(request.storagePath)
      ? request.storagePath
      : path.join(process.cwd(), request.storagePath);

    const fileStats = await fs.promises.stat(absolutePath);
    const fileHash = request.fileHash || (await calculateFileHash(absolutePath));

    const loaded = await loadUserText(absolutePath, request);
    let userText = loaded.text;
    const visualMetadata = loaded.metadata;

    console.log(`[Nvidia] Reading file: ${absolutePath}, Size: ${fileStats.size}, Extracted Text Length: ${userText.length}`);

    if (visualMetadata.visual_border_missing) {
      console.warn(`[Nvidia] Visual Audit Flag: Borders Missing detected in ${absolutePath}`);
    }

    const maxChars = Number(process.env.NVIDIA_INPUT_MAX_CHARS || 128000);
    if (Number.isFinite(maxChars) && maxChars > 1000 && userText.length > maxChars) {
      console.log(`[Nvidia] Truncating input from ${userText.length} to ${maxChars}`);
      userText = userText.slice(0, maxChars);
    }

    const systemPrompt = buildStrictParseSystemInstruction();

    try {
      const response = await axios.post<OpenAIResponse>(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userText },
          ],
          temperature: 0.2,
          max_tokens: 4096,
          stream: false,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 300000,
          signal,
        }
      );

      const rawContent = response.data?.choices?.[0]?.message?.content;
      const content = extractMessageText(rawContent);

      if (!content) {
        console.error('[Nvidia] Response missing content:', JSON.stringify(response.data));
        throw new LlmProviderError('NVIDIA response missing content', 'nvidia_empty_response');
      }

      console.log('[Nvidia] Raw Response (Preview):', content.slice(0, 500));

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(stripMarkdownJsonFences(content));
      } catch (error) {
        console.warn('[Nvidia] JSON parse failed, returning raw text wrapper:', error);
        parsed = { raw_text: content };
      }

      const output = {
        report_id: request.reportId,
        version_id: request.versionId,
        storage_path: request.storagePath,
        file_hash: fileHash,
        file_size: fileStats.size,
        generated_at: new Date().toISOString(),
        ...parsed,
        visual_audit: {
          ...((parsed.visual_audit as Record<string, unknown>) || {}),
          border_missing:
            !!visualMetadata.visual_border_missing || (parsed.visual_audit as any)?.table_border_missing === true,
          table_border_missing: (parsed.visual_audit as any)?.table_border_missing,
          notes: (parsed.visual_audit as any)?.notes,
        },
      };

      return {
        provider: this.provider,
        model: this.model,
        output,
        sourceText: userText,
      };
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  async generate(prompt: string, systemInstruction?: string, config?: GenerateConfig): Promise<{ text: string }> {
    try {
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
      const mergedSystemInstruction = this.mergeThinkingInstruction(systemInstruction, config?.thinkingBudget);
      if (mergedSystemInstruction) {
        messages.push({ role: 'system', content: mergedSystemInstruction });
      }
      messages.push({ role: 'user', content: prompt });

      const response = await axios.post<OpenAIResponse>(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.model,
          messages,
          temperature: config?.temperature ?? 0.4,
          max_tokens: config?.maxOutputTokens ?? 4096,
          stream: false,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 120000,
        }
      );

      const rawText = response.data?.choices?.[0]?.message?.content;
      const text = extractMessageText(rawText);

      if (!text) {
        console.error('[Nvidia] Generate response missing content:', JSON.stringify(response.data));
        throw new LlmProviderError('Empty response from NVIDIA API', 'nvidia_empty_response');
      }

      return { text };
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  private mergeThinkingInstruction(systemInstruction: string | undefined, thinkingBudget: unknown): string | undefined {
    if (systemInstruction && systemInstruction.includes('思维链模式已开启')) {
      return systemInstruction;
    }

    const budget = Number(thinkingBudget || 0);
    if (!Number.isFinite(budget) || budget <= 0) {
      return systemInstruction;
    }

    const thinkingHint = [
      `思维链模式已开启，推理预算为 ${Math.floor(budget)}。`,
      '请在内部进行逐步推理后再给出最终结论。',
      '最终输出只返回结果，不要暴露推理过程。',
    ].join('');

    return [systemInstruction, thinkingHint].filter(Boolean).join('\n\n');
  }

  private handleError(error: unknown): never {
    if (error instanceof LlmProviderError) {
      throw error;
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = JSON.stringify(error.response?.data || {});
      const message = status
        ? `Nvidia API request failed: ${status} - ${data}`
        : `Nvidia API request failed: ${error.message}`;
      console.error('[Nvidia] API Error:', message);
      throw new LlmProviderError(message, status ? 'nvidia_api_error' : 'nvidia_request_error');
    }

    const message = error instanceof Error ? error.message : 'Unknown Nvidia Error';
    console.error('[Nvidia] non-Axios error:', error);
    throw new LlmProviderError(message, 'nvidia_unknown_error');
  }
}
