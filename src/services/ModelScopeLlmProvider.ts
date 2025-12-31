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
        'deepseek-v3': 'deepseek-ai/DeepSeek-V3.2', // Updated to V3.2 as requested
        'deepseek-r1-32b': 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
        'glm-4.7': 'ZhipuAI/GLM-4-Plus',
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
                    enable_thinking: true // Enable thinking as requested
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

            const text = response.data?.choices?.[0]?.message?.content;
            if (!text) {
                console.error('[ModelScope] Response missing content:', JSON.stringify(response.data));
                throw new LlmProviderError('ModelScope response missing content', 'modelscope_empty_response');
            }
            console.log('[ModelScope] Raw Response (Preview):', text.slice(0, 500));

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
            if (error instanceof LlmProviderError) {
                throw error;
            }

            const axiosError = error as AxiosError;
            if (axiosError?.response) {
                const status = axiosError.response.status;
                const statusText = axiosError.response.statusText || 'unknown_error';

                console.error(`[ModelScope] API Error: ${status} ${statusText}`, axiosError.response.data);

                if (status === 429) {
                    throw new LlmProviderError('ModelScope API 限额已耗尽或并发过高 (Too Many Requests)', 'quota_exceeded');
                }
                if (status === 400) {
                    // ModelScope errors might be wrapped
                    const errData = axiosError.response.data as any;
                    const msg = errData?.message || JSON.stringify(errData);
                    throw new LlmProviderError(`ModelScope 请求无效: ${msg}`, 'invalid_request');
                }

                throw new LlmProviderError(`ModelScope request failed with status ${status}: ${statusText}`, 'modelscope_http_error');
            }

            const message = axiosError?.message || 'ModelScope request failed';
            throw new LlmProviderError(message, 'modelscope_request_error');
        }
    }
}
