import axios, { AxiosError } from 'axios';
import { LlmParseRequest, LlmParseResult, LlmProvider, LlmProviderError } from './LlmProvider';
import { buildSystemInstruction, loadUserText, stripMarkdownJsonFences } from './LlmCommon';

/**
 * GlmFlashLlmProvider - A specific provider for GLM-4-Flash and GLM-4.5-Flash using
 * the Zhipu AI official API.
 */
export class GlmFlashLlmProvider implements LlmProvider {
    constructor(
        private readonly apiKey: string,
        private readonly apiUrl: string,
        private readonly modelName: string = 'glm-4-flash'
    ) { }

    async parse(request: LlmParseRequest, signal?: AbortSignal): Promise<LlmParseResult> {
        try {
            const loaded = await loadUserText(request.storagePath, request);
            const systemPrompt = buildSystemInstruction();
            const userPrompt = loaded.text +
                '\n\nIMPORTANT: Return ONLY valid JSON as per instructions. No extra text.';

            const payload = {
                model: this.modelName,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                stream: false,
                temperature: 0.1,
                max_tokens: 4095
            };

            console.log(`[GLM-Flash] Sending request to official Zhipu API: ${this.apiUrl}...`);

            const response = await axios.post(this.apiUrl, payload, {
                timeout: 300000,
                signal: signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });

            if (response.status !== 200) {
                throw new LlmProviderError(`GLM-Flash API returned status ${response.status}`, 'glm_flash_api_error');
            }

            const result = response.data;
            const rawText = result.choices?.[0]?.message?.content ||
                (typeof result === 'string' ? result : JSON.stringify(result));

            console.log(`[GLM-Flash] Received response (${rawText.length} chars).`);

            let parsed: any;
            const stripped = stripMarkdownJsonFences(rawText);

            try {
                // Try direct parse first
                parsed = JSON.parse(stripped);
            } catch (error) {
                console.warn('[GLM-Flash] Initial JSON parse failed. Attempting to extract JSON block...');

                // Fallback: Attempt to find the first { and last }
                const firstBrace = stripped.indexOf('{');
                const lastBrace = stripped.lastIndexOf('}');

                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    const jsonBlock = stripped.substring(firstBrace, lastBrace + 1);
                    try {
                        parsed = JSON.parse(jsonBlock);
                        console.log('[GLM-Flash] Successfully extracted JSON block.');
                    } catch (innerError: any) {
                        console.error('[GLM-Flash] JSON extraction also failed:', innerError.message);
                        parsed = { raw_text: rawText, parse_error: innerError.message };
                    }
                } else {
                    console.error('[GLM-Flash] No JSON block found in response.');
                    parsed = { raw_text: rawText, parse_error: 'No JSON object found' };
                }
            }

            const output = {
                report_id: request.reportId,
                version_id: request.versionId,
                storage_path: request.storagePath,
                file_hash: request.fileHash,
                ...parsed,
                visual_audit: {
                    ...(parsed.visual_audit || {}),
                    border_missing: !!loaded.metadata.visual_border_missing,
                    notes: parsed.visual_audit?.notes || 'GLM-Flash official extraction'
                },
            };

            return {
                provider: 'glm-flash',
                model: this.modelName,
                output,
            };

        } catch (error) {
            if (error instanceof LlmProviderError) throw error;

            const axiosError = error as AxiosError;
            const message = axiosError?.message || 'GLM-Flash request failed';
            console.error(`[GLM-Flash] Error: ${message}`, axiosError?.response?.data);

            throw new LlmProviderError(`GLM-Flash 接口调用失败: ${message}`, 'glm_flash_request_error');
        }
    }
}
