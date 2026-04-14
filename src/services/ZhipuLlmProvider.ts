/**
 * 智谱 AI 官方 API Provider
 * 使用 OpenAI 兼容的 SDK 调用智谱官方 API
 * 
 * 官方文档: https://open.bigmodel.cn/
 */
import OpenAI from 'openai';
import path from 'path';
import fs from 'fs';
import { calculateFileHash } from '../utils/fileHash';
import { LlmParseRequest, LlmParseResult, LlmProvider, LlmProviderError } from './LlmProvider';
import { buildStrictParseSystemInstruction, loadUserText, stripMarkdownJsonFences } from './LlmCommon';

export class ZhipuLlmProvider implements LlmProvider {
    private readonly provider = 'zhipu';
    private readonly client: OpenAI;
    private readonly baseURL: string;

    constructor(private readonly apiKey: string, private readonly model: string) {
        this.baseURL = String(process.env.ZHIPU_BASE_URL || '').trim();
        if (!this.baseURL) {
            throw new LlmProviderError('ZHIPU_BASE_URL is required for Zhipu provider', 'zhipu_missing_base_url');
        }
        // 智谱官方 API 使用 OpenAI 兼容格式
        this.client = new OpenAI({
            apiKey: this.apiKey,
            baseURL: this.baseURL,
        });
    }

    // 模型别名映射
    private static readonly MODEL_MAP: Record<string, string> = {
        'glm-5-official': 'glm-5',
        'glm5-official': 'glm-5',
        'glm-4.7-flash-official': 'glm-4.7-flash',
        'glm-4.5-air-official': 'glm-4.5-air',
        'glm-4-plus-official': 'glm-4-plus',
        'glm-4-flash-official': 'glm-4-flash',
    };

    private resolveModelId(shortName: string): string {
        const rawAliases = String(process.env.ZHIPU_MODEL_ALIASES_JSON || '').trim();
        if (!rawAliases) {
            return shortName;
        }

        try {
            const aliases = JSON.parse(rawAliases) as Record<string, string>;
            if (aliases && typeof aliases === 'object') {
                return aliases[shortName] || shortName;
            }
        } catch (error) {
            console.warn('[Zhipu Official] Failed to parse ZHIPU_MODEL_ALIASES_JSON:', error);
        }

        return shortName;
    }

    async parse(request: LlmParseRequest, signal?: AbortSignal): Promise<LlmParseResult> {
        const absolutePath = path.isAbsolute(request.storagePath)
            ? request.storagePath
            : path.join(process.cwd(), request.storagePath);

        const fileStats = await fs.promises.stat(absolutePath);
        const fileHash = request.fileHash || (await calculateFileHash(absolutePath));

        const systemInstructionText = buildStrictParseSystemInstruction();

        const loaded = await loadUserText(absolutePath, request);
        let userText = loaded.text;
        const visualMetadata = loaded.metadata;

        const effectiveModel = this.resolveModelId(this.model);

        console.log(`[Zhipu Official] Reading file: ${absolutePath}, Size: ${fileStats.size}, Extracted Text Length: ${userText.length}, Model: ${effectiveModel} (Original: ${this.model})`);

        if (visualMetadata.visual_border_missing) {
            console.warn(`[Zhipu Official] Visual Audit Flag: Borders Missing detected in ${absolutePath}`);
        }

        const maxChars = Number(process.env.ZHIPU_INPUT_MAX_CHARS || 30000);
        if (Number.isFinite(maxChars) && maxChars > 1000 && userText.length > maxChars) {
            console.log(`[Zhipu Official] Truncating input from ${userText.length} to ${maxChars}`);
            userText = userText.slice(0, maxChars);
        }
        const parseTemperatureRaw = Number(process.env.LLM_PARSE_TEMPERATURE ?? 0);
        const parseTemperature = Number.isFinite(parseTemperatureRaw)
            ? Math.max(0, Math.min(1, parseTemperatureRaw))
            : 0;

        try {
            const response = await this.client.chat.completions.create({
                model: effectiveModel,
                messages: [
                    {
                        role: 'system',
                        content: systemInstructionText
                    },
                    {
                        role: 'user',
                        content: userText
                    }
                ],
                max_tokens: 16384,
                temperature: parseTemperature,
                top_p: 1,
                response_format: { type: 'json_object' },
                thinking: { type: 'disabled' },
            } as any, {
                signal: signal,
                timeout: 600000, // 10 minutes
            });

            const text = response.choices?.[0]?.message?.content;

            if (!text) {
                console.error('[Zhipu Official] Response missing content:', JSON.stringify(response));
                throw new LlmProviderError('Zhipu response missing content', 'zhipu_empty_response');
            }
            console.log('[Zhipu Official] Raw Response (Preview):', text.slice(0, 500));

            let parsed: any;
            try {
                parsed = JSON.parse(stripMarkdownJsonFences(text));
            } catch (error) {
                console.warn('[Zhipu Official] JSON parse failed, returning raw text. Error:', error);
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
                visual_audit: {
                    ...(parsed.visual_audit || {}),
                    border_missing: !!visualMetadata.visual_border_missing || (parsed.visual_audit?.table_border_missing === true),
                    table_border_missing: parsed.visual_audit?.table_border_missing,
                    notes: parsed.visual_audit?.notes,
                },
            };

            return {
                provider: this.provider,
                model: this.model,
                output,
                sourceText: userText,
            };

        } catch (error: any) {
            if (error instanceof LlmProviderError) {
                throw error;
            }

            console.error('[Zhipu Official] Full Error Details:', {
                message: error?.message,
                code: error?.code,
                status: error?.status,
                type: error?.type,
            });

            if (error?.status) {
                const status = error.status;

                if (status === 429) {
                    throw new LlmProviderError('智谱官方 API 限额已耗尽或并发过高 (Too Many Requests)', 'quota_exceeded');
                }
                if (status === 401 || status === 403) {
                    throw new LlmProviderError('智谱官方 API Key 无效或已过期', 'zhipu_auth_failed');
                }
                if (status === 400) {
                    throw new LlmProviderError(`智谱官方 API 请求无效: ${error.message}`, 'invalid_request');
                }

                throw new LlmProviderError(`智谱官方 API 请求失败 (HTTP ${status}): ${error.message}`, 'zhipu_http_error');
            }

            // Network-level errors
            const message = error?.message || 'Zhipu request failed';
            console.error(`[Zhipu Official] Network Error: ${message}`);

            if (error?.code === 'ECONNREFUSED') {
                throw new LlmProviderError('无法连接到智谱官方 API 服务器', 'zhipu_connection_refused');
            }
            if (error?.code === 'ETIMEDOUT' || message.includes('timeout')) {
                throw new LlmProviderError(`智谱官方 API 请求超时: ${message}`, 'zhipu_timeout');
            }

            throw new LlmProviderError(`智谱官方 API 请求失败: ${message}`, 'zhipu_request_error');
        }
    }
}
