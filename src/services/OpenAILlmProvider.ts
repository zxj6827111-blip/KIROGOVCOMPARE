import OpenAI from 'openai';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import { calculateFileHash } from '../utils/fileHash';
import { LlmParseRequest, LlmParseResult, LlmProvider, LlmProviderError } from './LlmProvider';
import {
    buildParseResponseSchema,
    buildStrictParseSystemInstruction,
    loadUserText,
    stripMarkdownJsonFences,
} from './LlmCommon';
import {
    AnnualReportSplitResult,
    Table2ParseResponse,
    Table3ParseResponse,
    Table4ParseResponse,
    buildTable2ParsePrompt,
    buildTable2ParseResponseSchema,
    buildTable2ParseSystemInstruction,
    buildTable3ParsePrompt,
    buildTable3ParseResponseSchema,
    buildTable3ParseSystemInstruction,
    buildTable4ParsePrompt,
    buildTable4ParseResponseSchema,
    buildTable4ParseSystemInstruction,
    hasMeaningfulTable4Data,
    mergeSegmentedAnnualReportParse,
    resolveSegmentedBodyParseResponse,
    splitAnnualReportForSegmentedParse,
    tryParseFlattenedTable4,
} from './SegmentedAnnualReportParse';

function parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
    if (!raw) return fallback;
    const normalized = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return fallback;
}

function sanitizeUpstreamErrorMessage(message: string, status?: number): string {
    const raw = String(message || '').trim();
    if (!raw) {
        return 'OpenAI request failed';
    }

    const containsHtml = raw.includes('<!DOCTYPE html') || /<html[\s>]/i.test(raw);
    if (containsHtml && status === 524) {
        return 'The configured OpenAI relay timed out (HTTP 524) before returning a response.';
    }

    if (containsHtml) {
        return 'The upstream service returned an HTML error page instead of a model response.';
    }

    return raw.length > 240 ? `${raw.slice(0, 240)}...` : raw;
}

export class OpenAILlmProvider implements LlmProvider {
    private readonly provider: string;
    private readonly client: OpenAI;
    private readonly apiMode: string;
    private readonly baseURL: string;

    constructor(
        private readonly apiKey: string,
        private readonly model: string,
        options?: {
            baseURL?: string;
            apiMode?: string;
            providerLabel?: string;
        }
    ) {
        this.provider = options?.providerLabel || 'openai';
        this.baseURL = String(options?.baseURL || process.env.OPENAI_BASE_URL || '').trim();
        this.apiMode = (options?.apiMode || process.env.OPENAI_API_MODE || 'responses').trim().toLowerCase();
        if (!this.baseURL) {
            throw new LlmProviderError('OPENAI_BASE_URL is required for OpenAI-compatible provider', 'openai_missing_base_url');
        }
        this.client = new OpenAI({
            apiKey: this.apiKey,
            baseURL: this.baseURL,
        });
    }

    async parse(request: LlmParseRequest, signal?: AbortSignal): Promise<LlmParseResult> {
        const absolutePath = path.isAbsolute(request.storagePath)
            ? request.storagePath
            : path.join(process.cwd(), request.storagePath);

        const fileStats = await fs.promises.stat(absolutePath);
        const fileHash = request.fileHash || (await calculateFileHash(absolutePath));
        const loaded = await loadUserText(absolutePath, request);
        const sourceText = loaded.text;
        const visualMetadata = loaded.metadata;
        const parseTemperatureRaw = Number(process.env.LLM_PARSE_TEMPERATURE ?? 0);
        const parseTemperature = Number.isFinite(parseTemperatureRaw)
            ? Math.max(0, Math.min(1, parseTemperatureRaw))
            : 0;

        try {
            const segmentedParseEnabled = parseBooleanEnv(process.env.OPENAI_SEGMENTED_PARSE_ENABLED, true);
            let parsed: any;

            if (segmentedParseEnabled) {
                const split = splitAnnualReportForSegmentedParse(sourceText);
                if (split.canUseSegmentedParse) {
                    console.log(
                        `[OpenAI] Using segmented parse with lengths body=${split.bodyText.length}, table2=${split.table2Text.length}, table3=${split.table3Text.length}, table4=${split.table4Text.length}`
                    );
                    parsed = await this.parseSegmentedAnnualReport(split, parseTemperature, signal);
                } else {
                    console.log(
                        `[OpenAI] Segmented parse unavailable, falling back to full document parse. Missing: ${split.missingSections.join(', ')}`
                    );
                    parsed = await this.parseFullDocument(sourceText, parseTemperature, signal);
                }
            } else {
                parsed = await this.parseFullDocument(sourceText, parseTemperature, signal);
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
                sourceText,
            };
        } catch (error: any) {
            throw this.normalizeError(error);
        }
    }

    private async parseFullDocument(
        sourceText: string,
        temperature: number,
        signal?: AbortSignal
    ): Promise<any> {
        const boundedText = this.truncatePrompt(sourceText, 'full_document');
        return this.requestStructuredJson(
            {
                prompt: boundedText,
                systemInstruction: buildStrictParseSystemInstruction(),
                temperature,
                maxOutputTokens: this.resolveStageMaxOutputTokens(16384),
                responseSchema: buildParseResponseSchema(),
                responseSchemaName: 'gov_report_parse',
                responseSchemaDescription: 'Structured extraction result for a Chinese government information disclosure annual report.',
                responseStrict: parseBooleanEnv(process.env.OPENAI_RESPONSE_STRICT, false),
                timeoutMs: this.resolveStageTimeoutMs(240000),
            },
            'full_document',
            signal
        );
    }

    private async parseSegmentedAnnualReport(
        split: AnnualReportSplitResult,
        temperature: number,
        signal?: AbortSignal
    ): Promise<any> {
        try {
            const table2 = await this.requestStructuredJson<Table2ParseResponse>(
                {
                    prompt: buildTable2ParsePrompt(this.truncatePrompt(split.table2Text, 'segmented_table_2')),
                    systemInstruction: buildTable2ParseSystemInstruction(),
                    temperature,
                    maxOutputTokens: this.resolveStageMaxOutputTokens(4096),
                    responseSchema: buildTable2ParseResponseSchema(),
                    responseSchemaName: 'gov_report_table_2_parse',
                    responseSchemaDescription: 'Structured extraction of section 2 from a Chinese government annual report.',
                    responseStrict: parseBooleanEnv(process.env.OPENAI_RESPONSE_STRICT, false),
                    timeoutMs: this.resolveStageTimeoutMs(90000),
                },
                'segmented_table_2',
                signal
            );

            const table3 = await this.requestStructuredJson<Table3ParseResponse>(
                {
                    prompt: buildTable3ParsePrompt(this.truncatePrompt(split.table3Text, 'segmented_table_3')),
                    systemInstruction: buildTable3ParseSystemInstruction(),
                    temperature,
                    maxOutputTokens: this.resolveStageMaxOutputTokens(8192),
                    responseSchema: buildTable3ParseResponseSchema(),
                    responseSchemaName: 'gov_report_table_3_parse',
                    responseSchemaDescription: 'Structured extraction of section 3 from a Chinese government annual report.',
                    responseStrict: parseBooleanEnv(process.env.OPENAI_RESPONSE_STRICT, false),
                    timeoutMs: this.resolveStageTimeoutMs(120000),
                },
                'segmented_table_3',
                signal
            );

            let table4: Table4ParseResponse;
            const deterministicTable4 = tryParseFlattenedTable4(split.table4Text);
            if (deterministicTable4) {
                console.log('[OpenAI] Parsed table_4 via deterministic flattened-row fallback.');
                table4 = { reviewLitigationData: deterministicTable4 };
            } else {
                table4 = await this.requestStructuredJson<Table4ParseResponse>(
                    {
                        prompt: buildTable4ParsePrompt(this.truncatePrompt(split.table4Text, 'segmented_table_4')),
                        systemInstruction: buildTable4ParseSystemInstruction(),
                        temperature,
                        maxOutputTokens: this.resolveStageMaxOutputTokens(2048),
                        responseSchema: buildTable4ParseResponseSchema(),
                        responseSchemaName: 'gov_report_table_4_parse',
                        responseSchemaDescription: 'Structured extraction of section 4 from a Chinese government annual report.',
                        responseStrict: parseBooleanEnv(process.env.OPENAI_RESPONSE_STRICT, false),
                        timeoutMs: this.resolveStageTimeoutMs(90000),
                    },
                    'segmented_table_4',
                    signal
                );

                if (!hasMeaningfulTable4Data(table4?.reviewLitigationData)) {
                    const fallbackTable4 = tryParseFlattenedTable4(split.table4Text);
                    if (!fallbackTable4) {
                        throw new LlmProviderError('Segmented table_4 parse returned empty content.', 'openai_empty_response');
                    }
                    console.log('[OpenAI] Recovered table_4 from deterministic fallback after empty model output.');
                    table4 = { reviewLitigationData: fallbackTable4 };
                }
            }

            if (!table2?.activeDisclosureData || typeof table2.activeDisclosureData !== 'object') {
                throw new LlmProviderError('Segmented table_2 parse returned no structured data.', 'openai_empty_response');
            }
            if (!table3?.tableData || typeof table3.tableData !== 'object') {
                throw new LlmProviderError('Segmented table_3 parse returned no structured data.', 'openai_empty_response');
            }

            return mergeSegmentedAnnualReportParse({
                body: resolveSegmentedBodyParseResponse(null, split),
                table2,
                table3,
                table4,
            });
        } catch (error: any) {
            if (error instanceof LlmProviderError) {
                throw error;
            }
            const normalized = this.normalizeError(error);
            throw new LlmProviderError(`Segmented annual report parse failed: ${normalized.message}`, normalized.code);
        }
    }

    private truncatePrompt(prompt: string, label: string): string {
        const raw = String(prompt || '');
        const maxChars = Number(process.env.OPENAI_INPUT_MAX_CHARS || 120000);
        if (!Number.isFinite(maxChars) || maxChars <= 1000 || raw.length <= maxChars) {
            return raw;
        }

        console.log(`[OpenAI] Truncating ${label} prompt from ${raw.length} to ${maxChars}`);
        return raw.slice(0, maxChars);
    }

    private resolveStageMaxOutputTokens(stageCap: number): number {
        const envValue = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 16384);
        const normalizedEnv = Number.isFinite(envValue) && envValue > 0 ? envValue : 16384;
        return Math.max(512, Math.min(normalizedEnv, stageCap));
    }

    private resolveStageTimeoutMs(stageFallback: number): number {
        const envValue = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || stageFallback);
        const normalizedEnv = Number.isFinite(envValue) && envValue > 0 ? envValue : stageFallback;
        return Math.max(30000, Math.min(normalizedEnv, stageFallback));
    }

    private async requestStructuredJson<T = any>(
        config: {
            prompt: string;
            systemInstruction?: string;
            temperature?: number;
            maxOutputTokens?: number;
            responseMimeType?: string;
            responseSchema?: unknown;
            responseSchemaName?: string;
            responseSchemaDescription?: string;
            responseStrict?: boolean;
            timeoutMs?: number;
        },
        label: string,
        signal?: AbortSignal
    ): Promise<T> {
        const text = await this.requestText(config, signal);
        console.log(`[OpenAI] ${label} response preview:`, text.slice(0, 500));

        try {
            return JSON.parse(stripMarkdownJsonFences(text));
        } catch (error: any) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new LlmProviderError(`OpenAI ${label} returned invalid JSON: ${reason}`, 'json_parse_error');
        }
    }

    async generate(prompt: string, systemInstruction?: string, config?: any): Promise<any> {
        const text = await this.requestText({
            prompt,
            systemInstruction,
            temperature: config?.temperature,
            maxOutputTokens: config?.maxOutputTokens,
            responseMimeType: config?.responseMimeType,
            responseSchema: config?.responseSchema,
            responseSchemaName: config?.responseSchemaName || 'generated_response',
            responseSchemaDescription: config?.responseSchemaDescription,
            responseStrict: config?.responseStrict,
            timeoutMs: config?.timeoutMs,
        });

        return { text };
    }

    private async requestText(
        config: {
            prompt: string;
            systemInstruction?: string;
            temperature?: number;
            maxOutputTokens?: number;
            responseMimeType?: string;
            responseSchema?: unknown;
            responseSchemaName?: string;
            responseSchemaDescription?: string;
            responseStrict?: boolean;
            timeoutMs?: number;
        },
        signal?: AbortSignal
    ): Promise<string> {
        const maxAttempts = this.resolveTransientRetryAttempts();
        let lastError: any = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                if (this.apiMode === 'chat_completions') {
                    return await this.requestTextViaChatCompletions(config, signal);
                }
                return await this.requestTextViaResponses(config, signal);
            } catch (error) {
                lastError = error;
                if (attempt >= maxAttempts || !this.shouldRetryRequest(error) || signal?.aborted) {
                    throw error;
                }

                const message = error instanceof Error ? error.message : String(error);
                const delayMs = Math.min(3000, 1000 * attempt);
                console.warn(`[OpenAI] Transient request failure on attempt ${attempt}/${maxAttempts}: ${message}. Retrying in ${delayMs}ms.`);
                await this.waitBeforeRetry(delayMs, signal);
            }
        }

        throw lastError;
    }

    private async requestTextViaResponses(config: {
        prompt: string;
        systemInstruction?: string;
        temperature?: number;
        maxOutputTokens?: number;
        responseMimeType?: string;
        responseSchema?: unknown;
        responseSchemaName?: string;
        responseSchemaDescription?: string;
        responseStrict?: boolean;
        timeoutMs?: number;
    }, signal?: AbortSignal): Promise<string> {
        let firstError: any = null;
        const requestTimeoutMs = this.resolveRequestTimeoutMs(config.timeoutMs);
        const { signal: scopedSignal, dispose } = this.createScopedAbortSignal(signal, requestTimeoutMs);

        try {
            try {
                const response = await this.client.responses.create({
                    model: this.model,
                    input: [
                        {
                            role: 'system',
                            content: config.systemInstruction || '',
                        },
                        {
                            role: 'user',
                            content: config.prompt,
                        },
                    ],
                    max_output_tokens: config.maxOutputTokens,
                    temperature: config.temperature,
                    store: !parseBooleanEnv(process.env.OPENAI_DISABLE_RESPONSE_STORAGE, true),
                    reasoning: this.buildReasoningConfig(),
                    text: this.buildResponsesTextConfig(config),
                } as any, {
                    signal: scopedSignal,
                    timeout: requestTimeoutMs,
                } as any);

                const text = this.extractResponseText(response);
                if (text) {
                    return text;
                }

                console.warn('[OpenAI] Responses API returned no content, retrying via SSE fallback.');
            } catch (error) {
                firstError = error;
                const reason = error instanceof Error ? error.message : String(error);
                if (!this.shouldRetryViaSse(error)) {
                    throw error;
                }
                console.warn(`[OpenAI] Responses API JSON mode failed, retrying via SSE fallback: ${reason}`);
            }

            try {
                const sseText = await this.requestTextViaResponsesSse(config, scopedSignal, requestTimeoutMs);
                if (sseText) {
                    return sseText;
                }
            } catch (sseError) {
                if (!firstError) {
                    firstError = sseError;
                }
            }

            if (firstError) {
                throw firstError;
            }

            throw new LlmProviderError('OpenAI response missing content', 'openai_empty_response');
        } finally {
            dispose();
        }
    }

    private async requestTextViaChatCompletions(config: {
        prompt: string;
        systemInstruction?: string;
        temperature?: number;
        maxOutputTokens?: number;
        responseMimeType?: string;
        timeoutMs?: number;
    }, signal?: AbortSignal): Promise<string> {
        const requestTimeoutMs = this.resolveRequestTimeoutMs(config.timeoutMs);
        const { signal: scopedSignal, dispose } = this.createScopedAbortSignal(signal, requestTimeoutMs);

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: 'system',
                        content: config.systemInstruction || '',
                    },
                    {
                        role: 'user',
                        content: config.prompt,
                    },
                ],
                max_tokens: config.maxOutputTokens,
                temperature: config.temperature,
                response_format: this.buildChatResponseFormat(config),
            } as any, {
                signal: scopedSignal,
                timeout: requestTimeoutMs,
            } as any);

            const text = response.choices?.[0]?.message?.content;
            if (!text) {
                throw new LlmProviderError('OpenAI chat completion missing content', 'openai_empty_response');
            }

            return text;
        } finally {
            dispose();
        }
    }

    private buildResponsesTextConfig(config: {
        responseMimeType?: string;
        responseSchema?: unknown;
        responseSchemaName?: string;
        responseSchemaDescription?: string;
        responseStrict?: boolean;
    }): any {
        if (config.responseSchema) {
            return {
                format: {
                    type: 'json_schema',
                    name: config.responseSchemaName || 'structured_output',
                    description: config.responseSchemaDescription,
                    schema: config.responseSchema,
                    strict: config.responseStrict ?? false,
                },
            };
        }

        const requestedMime = String(config.responseMimeType || '').toLowerCase();
        const defaultFormat = (process.env.OPENAI_RESPONSE_FORMAT || 'json_schema').trim().toLowerCase();

        if (requestedMime.includes('json')) {
            return {
                format: {
                    type: 'json_object',
                },
            };
        }

        if (defaultFormat === 'json_schema') {
            return {
                format: {
                    type: 'json_schema',
                    name: 'structured_output',
                    description: 'Generic structured JSON output.',
                    schema: {
                        type: 'object',
                        additionalProperties: true,
                    },
                    strict: false,
                },
            };
        }

        if (defaultFormat === 'json_object') {
            return {
                format: {
                    type: 'json_object',
                },
            };
        }

        return undefined;
    }

    private buildChatResponseFormat(config: { responseMimeType?: string }): any {
        const requestedMime = String(config.responseMimeType || '').toLowerCase();
        if (requestedMime.includes('json') || (process.env.OPENAI_RESPONSE_FORMAT || '').trim().toLowerCase() === 'json_object') {
            return { type: 'json_object' };
        }
        return undefined;
    }

    private buildReasoningConfig(): { effort: string } | undefined {
        const effort = (process.env.OPENAI_REASONING_EFFORT || '').trim().toLowerCase();
        if (!effort) {
            return undefined;
        }
        if (!['minimal', 'low', 'medium', 'high', 'xhigh'].includes(effort)) {
            return undefined;
        }
        return { effort };
    }

    private extractResponseText(response: any): string {
        if (typeof response?.output_text === 'string' && response.output_text.trim()) {
            return response.output_text;
        }

        const parts: string[] = [];
        const outputItems = Array.isArray(response?.output) ? response.output : [];
        for (const item of outputItems) {
            const contentList = Array.isArray(item?.content) ? item.content : [];
            for (const content of contentList) {
                if (content?.type === 'output_text' && typeof content?.text === 'string') {
                    parts.push(content.text);
                }
            }
        }

        return parts.join('').trim();
    }

    private async requestTextViaResponsesSse(config: {
        prompt: string;
        systemInstruction?: string;
        temperature?: number;
        maxOutputTokens?: number;
        responseMimeType?: string;
        responseSchema?: unknown;
        responseSchemaName?: string;
        responseSchemaDescription?: string;
        responseStrict?: boolean;
        timeoutMs?: number;
    }, signal?: AbortSignal, requestTimeoutMs?: number): Promise<string> {
        const url = `${this.baseURL.replace(/\/+$/, '')}/responses`;
        const response = await axios.post(
            url,
            {
                model: this.model,
                input: [
                    {
                        role: 'system',
                        content: config.systemInstruction || '',
                    },
                    {
                        role: 'user',
                        content: config.prompt,
                    },
                ],
                max_output_tokens: config.maxOutputTokens,
                temperature: config.temperature,
                store: !parseBooleanEnv(process.env.OPENAI_DISABLE_RESPONSE_STORAGE, true),
                reasoning: this.buildReasoningConfig(),
                text: this.buildResponsesTextConfig(config),
                stream: true,
            },
            {
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                },
                responseType: 'text',
                signal,
                timeout: requestTimeoutMs ?? this.resolveRequestTimeoutMs(config.timeoutMs),
                transformResponse: [(data) => data],
            }
        );

        const text = this.extractResponseTextFromSse(String(response.data || ''));
        if (!text) {
            throw new LlmProviderError('OpenAI SSE response missing content', 'openai_empty_response');
        }

        return text;
    }

    private extractResponseTextFromSse(raw: string): string {
        const eventBlocks = String(raw || '').split(/\r?\n\r?\n/);
        let combinedDeltas = '';
        let completedText = '';

        for (const block of eventBlocks) {
            const lines = block
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);

            for (const line of lines) {
                if (!line.startsWith('data: ')) {
                    continue;
                }

                const payload = line.slice('data: '.length).trim();
                if (!payload || payload === '[DONE]') {
                    continue;
                }

                let parsed: any;
                try {
                    parsed = JSON.parse(payload);
                } catch {
                    continue;
                }

                if (parsed?.type === 'response.output_text.delta' && typeof parsed?.delta === 'string') {
                    combinedDeltas += parsed.delta;
                    continue;
                }

                if (parsed?.type === 'response.output_text.done' && typeof parsed?.text === 'string') {
                    completedText += parsed.text;
                    continue;
                }
            }
        }

        return (completedText || combinedDeltas).trim();
    }

    private resolveRequestTimeoutMs(timeoutMs?: number): number {
        const envTimeout = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 600000);
        const preferred = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
            ? Number(timeoutMs)
            : envTimeout;
        return Math.max(30000, preferred);
    }

    private resolveTransientRetryAttempts(): number {
        const raw = Number(process.env.OPENAI_TRANSIENT_RETRY_ATTEMPTS || 2);
        if (!Number.isFinite(raw) || raw < 1) {
            return 1;
        }
        return Math.min(3, Math.floor(raw));
    }

    private async waitBeforeRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
        if (!signal) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return;
        }

        if (signal.aborted) {
            throw signal.reason || new Error('OpenAI request aborted');
        }

        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                signal.removeEventListener('abort', onAbort);
                resolve();
            }, delayMs);

            const onAbort = () => {
                clearTimeout(timer);
                signal.removeEventListener('abort', onAbort);
                reject(signal.reason || new Error('OpenAI request aborted'));
            };

            signal.addEventListener('abort', onAbort, { once: true });
        });
    }

    private createScopedAbortSignal(parentSignal: AbortSignal | undefined, timeoutMs: number): {
        signal: AbortSignal;
        dispose: () => void;
    } {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort(new Error(`OpenAI request timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        const onParentAbort = () => {
            controller.abort(parentSignal?.reason || new Error('OpenAI request aborted'));
        };

        if (parentSignal) {
            if (parentSignal.aborted) {
                onParentAbort();
            } else {
                parentSignal.addEventListener('abort', onParentAbort, { once: true });
            }
        }

        return {
            signal: controller.signal,
            dispose: () => {
                clearTimeout(timer);
                if (parentSignal) {
                    parentSignal.removeEventListener('abort', onParentAbort);
                }
            },
        };
    }

    private shouldRetryViaSse(error: any): boolean {
        if (!error) {
            return true;
        }

        const status = Number(error?.status || error?.response?.status || 0);
        const code = String(error?.code || '').toUpperCase();
        const message = String(error?.message || '').toLowerCase();

        if (status >= 500 || status === 429 || status === 401 || status === 403) {
            return false;
        }

        if (code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code === 'ECONNREFUSED') {
            return false;
        }

        if (message.includes('timeout') || message.includes('524')) {
            return false;
        }

        return true;
    }

    private shouldRetryRequest(error: any): boolean {
        if (!error) {
            return false;
        }

        if (error instanceof LlmProviderError) {
            return error.code === 'openai_empty_response';
        }

        const status = Number(error?.status || error?.response?.status || 0);
        if (status >= 400 && status < 500) {
            return false;
        }

        const code = String(error?.code || '').toUpperCase();
        if (['ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE', 'ECONNABORTED'].includes(code)) {
            return true;
        }

        const message = String(error?.message || '').toLowerCase();
        return (
            message.includes('client network socket disconnected before secure tls connection was established') ||
            message.includes('socket hang up') ||
            message.includes('connection error') ||
            message.includes('network error') ||
            message.includes('fetch failed')
        );
    }

    private normalizeError(error: any): LlmProviderError {
        if (error instanceof LlmProviderError) {
            return error;
        }

        const status = error?.status || error?.response?.status;
        const message = sanitizeUpstreamErrorMessage(error?.message || 'OpenAI request failed', status);

        if (status === 524) {
            return new LlmProviderError(
                'OpenAI relay timed out (HTTP 524). Please retry later or check the configured relay service.',
                'openai_http_error'
            );
        }

        if (status === 429) {
            return new LlmProviderError(`OpenAI API quota exceeded or request was rate-limited: ${message}`, 'quota_exceeded');
        }
        if (status === 401 || status === 403) {
            return new LlmProviderError('OpenAI API key is invalid, expired, or rejected by the relay.', 'openai_auth_failed');
        }
        if (status === 400) {
            return new LlmProviderError(`OpenAI API request was invalid: ${message}`, 'invalid_request');
        }
        if (status) {
            return new LlmProviderError(`OpenAI API request failed (HTTP ${status}): ${message}`, 'openai_http_error');
        }
        if (error?.code === 'ECONNREFUSED') {
            return new LlmProviderError('Could not connect to the OpenAI relay service.', 'openai_connection_refused');
        }
        if (
            error?.code === 'ETIMEDOUT' ||
            error?.name === 'AbortError' ||
            String(message).toLowerCase().includes('timeout') ||
            String(message).toLowerCase().includes('timed out')
        ) {
            return new LlmProviderError(`OpenAI API request timed out: ${message}`, 'openai_timeout');
        }

        return new LlmProviderError(`OpenAI API request failed: ${message}`, 'openai_request_error');
    }
}

