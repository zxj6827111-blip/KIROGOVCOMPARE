import axios, { AxiosError } from 'axios';
import path from 'path';
import fs from 'fs';
import { calculateFileHash } from '../utils/fileHash';
import { LlmParseRequest, LlmParseResult, LlmProvider, LlmProviderError } from './LlmProvider';
import { buildSystemInstruction, loadUserText, stripMarkdownJsonFences } from './LlmCommon';

interface OpenAiChatCompletionResponse {
    id: string;
    choices: Array<{
        message: {
            content: string;
        };
        finish_reason: string;
    }>;
    usage?: {
        total_tokens: number;
    };
}

export class ModelScopeLlmProvider implements LlmProvider {
    private readonly provider = 'modelscope';

    constructor(private readonly apiKey: string, private readonly model: string) { }

    // Mapping of frontend short codes to real ModelScope Model IDs
    private static readonly MODEL_MAP: Record<string, string> = {
        'qwen3-235b': 'Qwen/Qwen3-235B-A22B-Instruct-2507',
        'qwen3-30b': 'Qwen/Qwen2.5-32B-Instruct',
        'deepseek-v3': 'deepseek-ai/DeepSeek-V3.2',
        'deepseek-r1-32b': 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
        'mimo-v2': 'XiaomiMiMo/MiMo-V2-Flash',
    };

    private resolveModelId(shortName: string): string {
        // Return mapped name or original if not found (allows fallback to raw ID if user passes full ID)
        return ModelScopeLlmProvider.MODEL_MAP[shortName] || shortName;
    }

    async parse(request: LlmParseRequest, signal?: AbortSignal): Promise<LlmParseResult> {
        const absolutePath = path.isAbsolute(request.storagePath)
            ? request.storagePath
            : path.join(process.cwd(), request.storagePath);

        const fileStats = await fs.promises.stat(absolutePath);
        const fileHash = request.fileHash || (await calculateFileHash(absolutePath));

        const systemInstructionText = buildSystemInstruction() +
            '\nIMPORTANT: For "text" sections (Section 1, 5, 6), you MUST extract the FULL text content from the original document. Do NOT summarize. Do NOT use placeholders like "..." or "Wait for user content". If the text is present in the document, return it verbatim.\n' +
            'IMPORTANT: For Tables (Section 2, 3, 4), if a cell is explicitly "Empty" or contains "/", please output "0" for consistency, but try to infer if it means "0". If the document context implies it is "missing data", output "0" but note that we prefer data availability.';

        const loaded = await loadUserText(absolutePath, request);
        let userText = loaded.text;
        const visualMetadata = loaded.metadata;

        const effectiveModel = this.resolveModelId(this.model);

        console.log(`[ModelScope] Reading file: ${absolutePath}, Size: ${fileStats.size}, Extracted Text Length: ${userText.length}, Model: ${effectiveModel} (Original: ${this.model})`);

        if (visualMetadata.visual_border_missing) {
            console.warn(`[ModelScope] Visual Audit Flag: Borders Missing detected in ${absolutePath}`);
        }

        const maxChars = Number(process.env.MODELSCOPE_INPUT_MAX_CHARS || 30000); // ModelScope might have lower limits than Gemini
        if (Number.isFinite(maxChars) && maxChars > 1000 && userText.length > maxChars) {
            console.log(`[ModelScope] Truncating input from ${userText.length} to ${maxChars}`);
            userText = userText.slice(0, maxChars);
        }

        const url = 'https://api-inference.modelscope.cn/v1/chat/completions';

        // Only enable thinking for true reasoning models (R1, QwQ)
        const isReasoningModel = effectiveModel.toLowerCase().includes('r1') ||
            effectiveModel.toLowerCase().includes('qwq') ||
            this.model.toLowerCase().includes('r1') ||
            this.model.toLowerCase().includes('qwq');

        try {
            // NOTE: Using non-streaming request for simplicity in backend processing.
            // If streaming is needed for huge responses, we'd need to implement stream handling similar to the python example.
            const response = await axios.post<OpenAiChatCompletionResponse & { choices: Array<{ message: { reasoning_content?: string } }> }>(
                url,
                {
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
                    stream: false,
                    // Only enable thinking for reasoning models to avoid timeouts
                    ...(isReasoningModel ? { enable_thinking: true } : {})
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 600000, // 10 minutes timeout for large model inference
                    signal: signal,
                }
            );

            const message = response.data?.choices?.[0]?.message;
            const text = message?.content;
            const reasoning = message?.reasoning_content;

            if (reasoning) {
                console.log('[ModelScope] Thinking/Reasoning Process:\n', reasoning.slice(0, 500) + '...');
            }

            if (!text) {
                console.error('[ModelScope] Response missing content:', JSON.stringify(response.data));
                throw new LlmProviderError('ModelScope response missing content', 'modelscope_empty_response');
            }
            console.log('[ModelScope] Raw Response (Preview):', text.slice(0, 500));

            let parsed: any;
            try {
                parsed = JSON.parse(stripMarkdownJsonFences(text));
            } catch (error) {
                console.warn('[ModelScope] JSON parse failed, returning raw text. Error:', error);
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
            };

        } catch (error) {
            // RETRY LOGIC FOR BACKUP KEY
            const retryAxiosError = error as AxiosError;
            const status = retryAxiosError?.response?.status;

            // If authentication failed (401/403) and we haven't tried backup key yet
            // Assuming this.apiKey is the primary one passed from factory.
            // We check if a backup key exists in env and implies this was the primary attempt.
            // NOTE: ideally we pass backup key via constructor, but for quick fix reading env here is acceptable or
            // we updates the factory. A localized retry is simpler.
            const backupKey = process.env.MODELSCOPE_API_KEY_BACKUP;
            const isAuthError = status === 401 || status === 403 || (retryAxiosError?.response?.data as any)?.code === 'InvalidApiKey';

            if (isAuthError && backupKey && this.apiKey !== backupKey) {
                console.warn(`[ModelScope] Primary key failed (${status}), switching to backup key...`);
                try {
                    const response = await axios.post<OpenAiChatCompletionResponse & { choices: Array<{ message: { reasoning_content?: string } }> }>(
                        url,
                        {
                            model: effectiveModel,
                            messages: [
                                { role: 'system', content: systemInstructionText },
                                { role: 'user', content: userText }
                            ],
                            stream: false,
                            // Use same conditional thinking as primary request
                            ...(isReasoningModel ? { enable_thinking: true } : {})
                        },
                        {
                            headers: {
                                'Authorization': `Bearer ${backupKey}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: 600000,
                            signal: signal,
                        }
                    );

                    // Process backup response (duplicate logic, simplified)
                    const message = response.data?.choices?.[0]?.message;
                    const text = message?.content;
                    const reasoning = message?.reasoning_content;

                    if (reasoning) {
                        console.log('[ModelScope-Backup] Thinking:\n', reasoning.slice(0, 500) + '...');
                    }

                    if (!text) throw new LlmProviderError('Backup response missing content', 'modelscope_empty_response');
                    console.log('[ModelScope-Backup] Success!');

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
                        visual_audit: {
                            ...(parsed.visual_audit || {}),
                            border_missing: !!visualMetadata.visual_border_missing,
                            table_border_missing: parsed.visual_audit?.table_border_missing,
                            notes: parsed.visual_audit?.notes,
                        },
                    };

                    return {
                        provider: this.provider,
                        model: this.model,
                        output,
                    };
                } catch (backupError: any) {
                    console.error('[ModelScope] Backup key also failed:', backupError.message);
                    // Fall through to throw original error or new error?
                    // Let's throw the backup error to indicate total failure
                    throw new LlmProviderError(`ModelScope 主备 Key 均失败: ${backupError.message}`, 'modelscope_auth_failed_all');
                }
            }

            if (error instanceof LlmProviderError) {
                throw error;
            }

            const axiosError = error as AxiosError;

            // Log detailed error info for debugging
            console.error('[ModelScope] Full Error Details:', {
                message: axiosError?.message,
                code: axiosError?.code,
                status: axiosError?.response?.status,
                statusText: axiosError?.response?.statusText,
                data: axiosError?.response?.data,
            });

            if (axiosError?.response) {
                const status = axiosError.response.status;
                const statusText = axiosError.response.statusText || 'unknown_error';

                console.error(`[ModelScope] API Error: ${status} ${statusText}`, axiosError.response.data);

                if (status === 429) {
                    throw new LlmProviderError('ModelScope API 限额已耗尽或并发过高 (Too Many Requests)', 'quota_exceeded');
                }
                if (status === 400) {
                    const errData = axiosError.response.data as any;
                    const msg = errData?.message || (typeof errData === 'object' ? JSON.stringify(errData) : String(errData));
                    if (msg.includes('only support stream mode')) {
                        throw new LlmProviderError(`ModelScope 该模型仅支持流式输出 (Stream Mode)，请在配置中更换为其他模型（如 qwen2.5-72b-instruct 或 deepseek-v3）`, 'stream_mode_required');
                    }
                    throw new LlmProviderError(`ModelScope 请求无效: ${msg}`, 'invalid_request');
                }

                throw new LlmProviderError(`ModelScope request failed with status ${status}: ${statusText}`, 'modelscope_http_error');
            }

            // Network-level errors (DNS, connection refused, timeout, etc.)
            const message = axiosError?.message || 'ModelScope request failed';
            const errorCode = axiosError?.code || 'unknown';
            console.error(`[ModelScope] Network Error: ${message} (Code: ${errorCode})`);

            if (axiosError?.code === 'ECONNREFUSED') {
                throw new LlmProviderError('无法连接到 ModelScope API 服务器 (连接被拒绝)', 'modelscope_connection_refused');
            }
            if (axiosError?.code === 'ENOTFOUND') {
                throw new LlmProviderError('无法解析 ModelScope API 域名 (DNS 错误)', 'modelscope_dns_error');
            }
            if (axiosError?.code === 'ETIMEDOUT' || message.includes('timeout')) {
                throw new LlmProviderError(`ModelScope 请求超时: ${message}`, 'modelscope_timeout');
            }

            throw new LlmProviderError(`ModelScope 请求失败: ${message}`, 'modelscope_request_error');
        }
    }
}
