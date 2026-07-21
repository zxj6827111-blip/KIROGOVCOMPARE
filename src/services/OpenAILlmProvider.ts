import { mergeStructuredFields } from '../utils/structuredFieldMerge';
import { tryParseTable2FromSourceText } from './TableSectionScoring';
import OpenAI from 'openai';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import { fetch as undiciFetch } from 'undici';
import { calculateFileHash } from '../utils/fileHash';
import { getProxyDispatcher, resolveProxyUrl, sanitizeProxyUrlForLog } from '../utils/httpProxy';
import { LlmParseRequest, LlmParseResult, LlmProvider, LlmProviderError } from './LlmProvider';
import {
    buildParseResponseSchema,
    buildTable3Skeleton,
    buildStrictParseSystemInstruction,
    loadUserText,
    parseStructuredJsonFromText,
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
    normalizeTable2ParseResponse,
    normalizeTable3ParseResponse,
    normalizeTable4ParseResponse,
    resolveSegmentedBodyParseResponse,
    splitAnnualReportForSegmentedParse,
    tryParseFlattenedTable4,
    looksLikeReviewLitigationSegment,
    looksLikeApplicationOnlySegment,
} from './SegmentedAnnualReportParse';
import { runSegmentWithRetries } from '../utils/segmentRetry';

const OPENAI_DEBUG_LOGS = process.env.LLM_DEBUG_LOGS === '1';

type PdfJsModule = {
    getDocument: (options: Record<string, unknown>) => { promise: Promise<any> };
    OPS?: Record<string, number>;
};

type PdfVisualTableId = 'table_2' | 'table_3' | 'table_4';

type PdfVisualPageCandidate = {
    pageNumber: number;
    text: string;
    imageCount: number;
    viewportHeight: number;
    table2TitleY: number | null;
    table3TitleY: number | null;
    table4TitleY: number | null;
};

type PdfRenderedImage = {
    path: string;
    pageNumbers: number[];
};

type PdfVisualTableAttempt = {
    tableId: PdfVisualTableId;
    pageNumbers: number[];
    status: 'render_unavailable' | 'empty_payload' | 'success' | 'request_failed' | 'no_candidate';
};
let pdfjsPromise: Promise<PdfJsModule> | null = null;

function loadPdfjs(): Promise<PdfJsModule> {
    if (!pdfjsPromise) {
        pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod: any) => mod.default || mod);
    }
    return pdfjsPromise;
}

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

function isLoopbackOrLocalhost(hostname: string): boolean {
    const normalized = hostname.trim().toLowerCase();
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]';
}

function assertSecureBaseUrl(baseURL: string, provider: string): void {
    let parsed: URL;
    try {
        parsed = new URL(baseURL);
    } catch {
        throw new LlmProviderError(`${provider} base URL is invalid`, 'llm_invalid_base_url');
    }

    if (parsed.protocol === 'https:') {
        return;
    }

    if (parsed.protocol === 'http:' && isLoopbackOrLocalhost(parsed.hostname) && process.env.NODE_ENV !== 'production') {
        return;
    }

    throw new LlmProviderError(
        `${provider} base URL must use HTTPS outside local development`,
        'llm_insecure_base_url'
    );
}

function isPlainObject(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasMeaningfulLeaf(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.some((item) => hasMeaningfulLeaf(item));
    if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some((item) => hasMeaningfulLeaf(item));
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    return true;
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
        assertSecureBaseUrl(this.baseURL, this.provider);
        const proxyUrl = this.resolveProxyUrl();
        const dispatcher = getProxyDispatcher(proxyUrl);
        if (proxyUrl) {
            console.log(`[OpenAI:${this.provider}] Using proxy ${sanitizeProxyUrlForLog(proxyUrl)}`);
        }
        this.client = new OpenAI({
            apiKey: this.apiKey,
            baseURL: this.baseURL,
            fetch: dispatcher
                ? ((input: any, init?: any) => undiciFetch(input, { ...(init || {}), dispatcher: init?.dispatcher || dispatcher } as any)) as any
                : undefined,
        });
    }

    private resolveProxyUrl(): string {
        if (this.provider === 'gemini_openai') {
            return resolveProxyUrl(['GEMINI_OPENAI_PROXY_URL', 'GEMINI_PROXY_URL', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY']);
        }

        return resolveProxyUrl(['OPENAI_PROXY_URL', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY']);
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
            const split = splitAnnualReportForSegmentedParse(sourceText);

            if (await this.shouldUsePdfVisualTablesParse(absolutePath, split, visualMetadata)) {
                console.log(
                    `[OpenAI] Using PDF visual tables parse. Missing: ${split.missingSections.join(', ')}`
                );
                parsed = await this.parsePdfWithLocalTextAndVisualTables(absolutePath, sourceText, signal);
            } else if (segmentedParseEnabled) {
                if (this.canUseSegmentedParse(split)) {
                    console.log(
                        `[OpenAI] Using ${split.canUseSegmentedParse ? 'segmented' : 'partial segmented'} parse with lengths body=${split.bodyText.length}, table2=${split.table2Text.length}, table3=${split.table3Text.length}, table4=${split.table4Text.length}`
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

            parsed = await this.augmentParsedWithPdfVisualTables(parsed, absolutePath, sourceText, signal);

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

    private canUseSegmentedParse(split: AnnualReportSplitResult): boolean {
        if (split.canUseSegmentedParse) {
            return true;
        }

        if (!parseBooleanEnv(process.env.OPENAI_PARTIAL_SEGMENTED_PARSE_ENABLED, true)) {
            return false;
        }

        return !!split.segments.overallSituation && !!split.segments.problemsAndImprovements && !!split.table2Text && !!split.table3Text;
    }

    private buildEmptyTable4ParseResponse(): Table4ParseResponse {
        const emptyBlock = { maintain: null, correct: null, other: null, unfinished: null, total: null };
        return {
            reviewLitigationData: {
                review: { ...emptyBlock },
                litigationDirect: { ...emptyBlock },
                litigationPostReview: { ...emptyBlock },
            },
        };
    }

    private async shouldUsePdfVisualTablesParse(
        absolutePath: string,
        split: AnnualReportSplitResult,
        visualMetadata?: { visual_border_missing?: boolean; format?: string }
    ): Promise<boolean> {
        if (!parseBooleanEnv(process.env.LLM_PARSE_PDF_VISUAL_TABLE_PARSE_ENABLED, true)) {
            return false;
        }
        if (!absolutePath.toLowerCase().endsWith('.pdf')) {
            return false;
        }
        if (!split.segments.overallSituation || !split.segments.problemsAndImprovements) {
            return false;
        }
        const missingTableSection = split.missingSections.some((section) =>
            section === 'activeDisclosure' ||
            section === 'applicationRequests' ||
            section === 'reviewLitigation'
        );
        const candidates = await this.locatePdfVisualTablePages(absolutePath);
        const hasVisualTableCandidate = candidates.some((page) =>
            page.imageCount > 0 ||
            page.table2TitleY !== null ||
            page.table3TitleY !== null ||
            page.table4TitleY !== null
        );
        const unreliablePdfTableText = visualMetadata?.visual_border_missing === true && hasVisualTableCandidate;
        if (split.canUseSegmentedParse) {
            return false;
        }
        if (unreliablePdfTableText) {
            return missingTableSection;
        }
        return missingTableSection && hasVisualTableCandidate;
    }

    private async parsePdfWithLocalTextAndVisualTables(
        absolutePath: string,
        sourceText: string,
        signal?: AbortSignal
    ): Promise<any> {
        const split = splitAnnualReportForSegmentedParse(sourceText);
        const candidates = await this.locatePdfVisualTablePages(absolutePath);
        const visualTables = await this.parseVisualTablesFromPdf(absolutePath, candidates, ['table_2', 'table_3', 'table_4'], signal);
        const parsed = mergeSegmentedAnnualReportParse({
            body: resolveSegmentedBodyParseResponse(null, split),
            table2: { activeDisclosureData: visualTables.table2 || null },
            table3: { tableData: visualTables.table3 || null },
            table4: { reviewLitigationData: visualTables.table4 || null },
        }) as Record<string, any>;
        parsed.raw_text = sourceText;
        parsed.report_type = 'government_information_disclosure_annual_report';
        parsed.basic_info = this.extractBasicInfoFromSourceText(sourceText);
        parsed.visual_audit = {
            ...(parsed.visual_audit || {}),
            pdf_visual_table_parse: true,
            pdf_visual_table_repairs: visualTables.repairs,
            pdf_visual_table_attempts: visualTables.attempts,
            segmented_missing_sections: split.missingSections,
        };
        console.log(
            `[OpenAI] Applied PDF visual tables parse: ${visualTables.repairs.join(', ') || 'none'}; attempts=${JSON.stringify(visualTables.attempts)}`
        );
        return parsed;
    }

    private extractBasicInfoFromSourceText(sourceText: string): Record<string, unknown> {
        const normalized = String(sourceText || '').replace(/\r\n?/g, '\n');
        const lines = normalized
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        const title = lines.find((line) => line.includes('年度报告')) || null;
        const yearMatch = title?.match(/(20\d{2})\s*年/) || normalized.match(/(20\d{2})\s*年\s*1\s*月\s*1\s*日/);
        const contactText = normalized.slice(0, Math.min(normalized.length, 1600));
        return {
            title,
            report_period: yearMatch ? `${yearMatch[1]}年1月1日至${yearMatch[1]}年12月31日` : null,
            contact: {
                address: this.matchFirst(contactText, /地址[：:]\s*([^，,；;\n]+)/),
                postcode: this.matchFirst(contactText, /邮编[：:]\s*([0-9]{6})/),
                phone: this.matchFirst(contactText, /电话[：:]\s*([0-9\-]+)/),
                email: this.matchFirst(contactText, /电子邮箱[：:]\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/),
            },
        };
    }

    private matchFirst(text: string, pattern: RegExp): string | null {
        const match = text.match(pattern);
        return match?.[1]?.trim() || null;
    }

    private async parseFullDocument(
        sourceText: string,
        temperature: number,
        signal?: AbortSignal
    ): Promise<any> {
        const boundedText = this.truncatePrompt(sourceText, 'full_document');
        const reasoningEffort = this.resolveParseReasoningEffort();
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
                reasoningEffort,
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
            const reasoningEffort = this.resolveParseReasoningEffort();
            const parallelTables = parseBooleanEnv(process.env.OPENAI_SEGMENTED_PARALLEL_TABLES, true);

            const runTable2 = () =>
                runSegmentWithRetries(
                    'segmented_table_2',
                    async () =>
                        normalizeTable2ParseResponse(
                            await this.requestStructuredJson<Table2ParseResponse>(
                                {
                                    prompt: buildTable2ParsePrompt(
                                        this.truncatePrompt(split.table2Text, 'segmented_table_2')
                                    ),
                                    systemInstruction: buildTable2ParseSystemInstruction(),
                                    temperature,
                                    maxOutputTokens: this.resolveStageMaxOutputTokens(4096),
                                    responseSchema: buildTable2ParseResponseSchema(),
                                    responseSchemaName: 'gov_report_table_2_parse',
                                    responseSchemaDescription:
                                        'Structured extraction of section 2 from a Chinese government annual report.',
                                    responseStrict: parseBooleanEnv(process.env.OPENAI_RESPONSE_STRICT, false),
                                    timeoutMs: this.resolveStageTimeoutMs(90000),
                                    reasoningEffort,
                                },
                                'segmented_table_2',
                                signal
                            )
                        ),
                    {
                        signal,
                        onRetry: ({ label, attempt, maxAttempts, delayMs, error }) => {
                            const msg = error instanceof Error ? error.message : String(error);
                            console.warn(
                                `[OpenAI] ${label} attempt ${attempt}/${maxAttempts} failed (${msg}). Retrying in ${delayMs}ms.`
                            );
                        },
                    }
                );

            const runTable3 = () =>
                runSegmentWithRetries(
                    'segmented_table_3',
                    async () =>
                        normalizeTable3ParseResponse(
                            await this.requestStructuredJson<Table3ParseResponse>(
                                {
                                    prompt: buildTable3ParsePrompt(
                                        this.truncatePrompt(split.table3Text, 'segmented_table_3')
                                    ),
                                    systemInstruction: buildTable3ParseSystemInstruction(),
                                    temperature,
                                    maxOutputTokens: this.resolveStageMaxOutputTokens(8192),
                                    responseSchema: buildTable3ParseResponseSchema(),
                                    responseSchemaName: 'gov_report_table_3_parse',
                                    responseSchemaDescription:
                                        'Structured extraction of section 3 from a Chinese government annual report.',
                                    responseStrict: parseBooleanEnv(process.env.OPENAI_RESPONSE_STRICT, false),
                                    timeoutMs: this.resolveStageTimeoutMs(120000),
                                    reasoningEffort,
                                },
                                'segmented_table_3',
                                signal
                            )
                        ),
                    {
                        signal,
                        onRetry: ({ label, attempt, maxAttempts, delayMs, error }) => {
                            const msg = error instanceof Error ? error.message : String(error);
                            console.warn(
                                `[OpenAI] ${label} attempt ${attempt}/${maxAttempts} failed (${msg}). Retrying in ${delayMs}ms.`
                            );
                        },
                    }
                );

            // Table 2/3 are independent — parallel cuts latency; each segment retries alone on 524/timeout.
            let table2: Table2ParseResponse;
            let table3: Table3ParseResponse;
            if (parallelTables) {
                console.log('[OpenAI] Segmented parse: running table_2 and table_3 in parallel with per-segment retries.');
                [table2, table3] = await Promise.all([runTable2(), runTable3()]);
                {
                    const detT2 = tryParseTable2FromSourceText(split.table2Text || '');
                    if (detT2) {
                        const existing = table2?.activeDisclosureData || {};
                        const merged = mergeStructuredFields(existing, detT2);
                        table2 = { activeDisclosureData: merged.merged };
                        console.log(
                            '[OpenAI] Merged table_2 deterministic fields',
                            { used: merged.usedDeterministicPaths.length, conflicts: merged.conflicts.length }
                        );
                        if (merged.conflicts.length) {
                            (table2 as any).merge_conflicts = merged.conflicts;
                        }
                    }
                }
            } else {
                table2 = await runTable2();
                {
                    const detT2Seq = tryParseTable2FromSourceText(split.table2Text || '');
                    if (detT2Seq) {
                        console.log('[OpenAI] Parsed table_2 via deterministic source anchors.');
                        table2 = { activeDisclosureData: detT2Seq };
                    }
                }
                table3 = await runTable3();
            }

            let table4: Table4ParseResponse;
            // Prefer deterministic table_4 before any LLM call (avoids empty_response window).
            const deterministicTable4 = split.table4Text ? tryParseFlattenedTable4(split.table4Text) : null;
            if (!split.table4Text) {
                console.log('[OpenAI] table_4 section missing in partial segmented parse; using empty table_4.');
                table4 = this.buildEmptyTable4ParseResponse();
            } else if (deterministicTable4) {
                console.log('[OpenAI] Parsed table_4 via deterministic flattened-row fallback.');
                table4 = { reviewLitigationData: deterministicTable4 };
            } else {
                table4 = await runSegmentWithRetries(
                    'segmented_table_4',
                    async () => {
                        const parsed = normalizeTable4ParseResponse(
                            await this.requestStructuredJson<Table4ParseResponse>(
                                {
                                    prompt: buildTable4ParsePrompt(
                                        this.truncatePrompt(split.table4Text, 'segmented_table_4')
                                    ),
                                    systemInstruction: buildTable4ParseSystemInstruction(),
                                    temperature,
                                    maxOutputTokens: this.resolveStageMaxOutputTokens(2048),
                                    responseSchema: buildTable4ParseResponseSchema(),
                                    responseSchemaName: 'gov_report_table_4_parse',
                                    responseSchemaDescription:
                                        'Structured extraction of section 4 from a Chinese government annual report.',
                                    responseStrict: parseBooleanEnv(process.env.OPENAI_RESPONSE_STRICT, false),
                                    timeoutMs: this.resolveStageTimeoutMs(90000),
                                    reasoningEffort,
                                },
                                'segmented_table_4',
                                signal
                            )
                        );
                        if (!hasMeaningfulTable4Data(parsed?.reviewLitigationData)) {
                            const fallbackTable4 = tryParseFlattenedTable4(split.table4Text);
                            if (!fallbackTable4) {
                                if (
                                    looksLikeApplicationOnlySegment(split.table4Text) ||
                                    !looksLikeReviewLitigationSegment(split.table4Text)
                                ) {
                                    console.warn(
                                        '[OpenAI] table_4 segment does not look like review/litigation; using empty table_4 skeleton.'
                                    );
                                    return this.buildEmptyTable4ParseResponse();
                                }
                                throw new LlmProviderError(
                                    'Segmented table_4 parse returned empty content.',
                                    'openai_empty_response'
                                );
                            }
                            console.log(
                                '[OpenAI] Recovered table_4 from deterministic fallback after empty model output.'
                            );
                            return { reviewLitigationData: fallbackTable4 };
                        }
                        return parsed;
                    },
                    {
                        signal,
                        onRetry: ({ label, attempt, maxAttempts, delayMs, error }) => {
                            const msg = error instanceof Error ? error.message : String(error);
                            console.warn(
                                `[OpenAI] ${label} attempt ${attempt}/${maxAttempts} failed (${msg}). Retrying in ${delayMs}ms.`
                            );
                        },
                    }
                );
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

    private async augmentParsedWithPdfVisualTables(
        parsed: any,
        absolutePath: string,
        sourceText: string,
        signal?: AbortSignal
    ): Promise<any> {
        if (!parseBooleanEnv(process.env.LLM_PARSE_PDF_VISUAL_TABLE_FALLBACK_ENABLED, true)) {
            return parsed;
        }
        if (!absolutePath.toLowerCase().endsWith('.pdf')) {
            return parsed;
        }

        const split = splitAnnualReportForSegmentedParse(sourceText);
        const missingTable2 = !this.getSectionPayload(parsed, 'table_2');
        const missingTable3 = !this.getSectionPayload(parsed, 'table_3');
        const missingTable4 = !this.getSectionPayload(parsed, 'table_4');
        if (!missingTable2 && !missingTable3 && !missingTable4) {
            return parsed;
        }

        const candidates = await this.locatePdfVisualTablePages(absolutePath);
        const sections = this.ensureParsedSections(parsed);
        const wanted: PdfVisualTableId[] = [];
        if (missingTable2) wanted.push('table_2');
        if (missingTable3) wanted.push('table_3');
        if (missingTable4) wanted.push('table_4');
        const visualTables = await this.parseVisualTablesFromPdf(absolutePath, candidates, wanted, signal);
        const repaired: string[] = visualTables.repairs;

        if (missingTable2 && visualTables.table2) {
            this.upsertSectionPayload(sections, 'table_2', 'activeDisclosureData', visualTables.table2);
        }
        if (missingTable3 && visualTables.table3) {
            this.upsertSectionPayload(sections, 'table_3', 'tableData', visualTables.table3);
        }
        if (missingTable4 && visualTables.table4) {
            this.upsertSectionPayload(sections, 'table_4', 'reviewLitigationData', visualTables.table4);
        }

        parsed.sections = sections;
        parsed.visual_audit = {
            ...(parsed.visual_audit || {}),
            pdf_visual_table_fallback: repaired.length > 0,
            pdf_visual_table_repairs: repaired,
            pdf_visual_table_attempts: visualTables.attempts,
            segmented_missing_sections: split.missingSections,
        };
        console.log(
            `[OpenAI] Applied PDF visual table fallback: ${repaired.join(', ') || 'none'}; attempts=${JSON.stringify(visualTables.attempts)}`
        );

        return parsed;
    }

    private ensureParsedSections(parsed: any): Array<Record<string, any>> {
        if (!parsed || typeof parsed !== 'object') {
            return [];
        }
        if (!Array.isArray(parsed.sections)) {
            parsed.sections = [];
        }
        return parsed.sections.filter((section: unknown): section is Record<string, any> => isPlainObject(section));
    }

    private getSectionPayload(parsed: any, type: PdfVisualTableId): Record<string, any> | null {
        const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
        const section = sections.find((item: any) => item?.type === type);
        const payloadKey = this.payloadKeyForTable(type);
        const payload = section?.[payloadKey] ?? parsed?.[payloadKey];
        return isPlainObject(payload) && hasMeaningfulLeaf(payload) ? payload : null;
    }

    private payloadKeyForTable(type: PdfVisualTableId): 'activeDisclosureData' | 'tableData' | 'reviewLitigationData' {
        if (type === 'table_2') return 'activeDisclosureData';
        if (type === 'table_3') return 'tableData';
        return 'reviewLitigationData';
    }

    private upsertSectionPayload(
        sections: Array<Record<string, any>>,
        type: PdfVisualTableId,
        payloadKey: 'activeDisclosureData' | 'tableData' | 'reviewLitigationData',
        payload: Record<string, any>
    ): void {
        const titles = {
            table_2: '????????????',
            table_3: '?????????????????',
            table_4: '???????????????????',
        };
        let section = sections.find((item) => item?.type === type);
        if (!section) {
            section = { title: titles[type], type };
            sections.push(section);
        }
        section.title = section.title || titles[type];
        section.type = type;
        section[payloadKey] = payload;
    }

    private async locatePdfVisualTablePages(absolutePath: string): Promise<PdfVisualPageCandidate[]> {
        const pdfjs = await loadPdfjs();
        const data = new Uint8Array(await fs.promises.readFile(absolutePath));
        const loadingTask = pdfjs.getDocument({
            data,
            disableWorker: true,
            disableFontFace: true,
            isEvalSupported: false,
        });
        const pdf = await loadingTask.promise;
        try {
            const pages: PdfVisualPageCandidate[] = [];
            for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
                const page = await pdf.getPage(pageNumber);
                const viewport = page.getViewport({ scale: 1 });
                const textContent = await page.getTextContent();
                const textItems = (textContent.items || [])
                    .map((item: any) => ({
                        text: typeof item?.str === 'string' ? item.str.replace(/\s+/g, '') : '',
                        y: Array.isArray(item?.transform) && Number.isFinite(item.transform[5]) ? Number(item.transform[5]) : null,
                    }))
                    .filter((item: { text: string }) => item.text.length > 0);
                const text = textItems.map((item: { text: string }) => item.text).join('');
                let imageCount = 0;
                try {
                    const ops = await page.getOperatorList();
                    const OPS = pdfjs.OPS || {};
                    imageCount = (ops.fnArray || []).filter((fn: number) =>
                        fn === OPS.paintImageXObject ||
                        fn === OPS.paintInlineImageXObject ||
                        fn === OPS.paintJpegXObject
                    ).length;
                } catch {
                    imageCount = 0;
                }
                pages.push({
                    pageNumber,
                    text,
                    imageCount,
                    viewportHeight: viewport.height,
                    table2TitleY: this.findVisualTitleY(textItems, [
                        '主动公开政府信息情况',
                        '主动公开',
                    ]),
                    table3TitleY: this.findVisualTitleY(textItems, [
                        '收到和处理政府信息公开申请情况',
                        '收到和处理',
                        '处理政府信息公开申请',
                    ]),
                    table4TitleY: this.findVisualTitleY(textItems, [
                        '政府信息公开行政复议、行政诉讼情况',
                        '行政复议、行政诉讼',
                        '行政复议',
                    ]),
                });
            }
            return pages;
        } finally {
            await pdf.destroy?.();
        }
    }

    private findVisualTitleY(items: Array<{ text: string; y: number | null }>, keywords: string[]): number | null {
        for (const item of items) {
            if (item.y === null) continue;
            if (keywords.some((keyword) => item.text.includes(keyword))) {
                return item.y;
            }
        }
        return null;
    }

    private pickVisualTablePage(
        pages: PdfVisualPageCandidate[],
        tableId: PdfVisualTableId
    ): number | null {
        const titlePage = this.pickVisualTableTitlePage(pages, tableId);
        if (titlePage) {
            if (titlePage.imageCount > 0) {
                const titleKey = this.visualTableTitleKey(tableId);
                const titleY = Number(titlePage[titleKey]);
                const nextImagePage = pages.find((page) => page.pageNumber > titlePage.pageNumber && page.imageCount > 0);
                const samePageLikelyStartsAfterTitle = titleY >= titlePage.viewportHeight * 0.55;
                if (samePageLikelyStartsAfterTitle) {
                    return titlePage.pageNumber;
                }
                if (nextImagePage) {
                    return nextImagePage.pageNumber;
                }
                return titlePage.pageNumber;
            }
            const nextImagePage = pages.find((page) => page.pageNumber > titlePage.pageNumber && page.imageCount > 0);
            if (nextImagePage) {
                return nextImagePage.pageNumber;
            }
            return titlePage.pageNumber;
        }

        const imagePages = pages.filter((page) => page.imageCount > 0);
        if (!imagePages.length) {
            return null;
        }
        if (tableId === 'table_2') {
            return imagePages[0]?.pageNumber || null;
        }
        if (tableId === 'table_3') {
            return imagePages[Math.min(1, imagePages.length - 1)]?.pageNumber || null;
        }
        return imagePages[imagePages.length - 1]?.pageNumber || null;
    }

    private visualTableTitleKey(tableId: PdfVisualTableId): 'table2TitleY' | 'table3TitleY' | 'table4TitleY' {
        if (tableId === 'table_2') return 'table2TitleY';
        if (tableId === 'table_3') return 'table3TitleY';
        return 'table4TitleY';
    }

    private pickVisualTableTitlePage(
        pages: PdfVisualPageCandidate[],
        tableId: PdfVisualTableId
    ): PdfVisualPageCandidate | null {
        const titleKey = this.visualTableTitleKey(tableId);
        const titlePages = pages.filter((page) => typeof page[titleKey] === 'number');
        if (!titlePages.length) {
            return null;
        }
        if (tableId === 'table_2') {
            const table3TitlePage = pages.find((page) => page.table3TitleY !== null)?.pageNumber;
            const beforeTable3 = titlePages.filter((page) => !table3TitlePage || page.pageNumber <= table3TitlePage);
            return beforeTable3[beforeTable3.length - 1] || titlePages[titlePages.length - 1] || null;
        }
        if (tableId === 'table_3') {
            const table2TitlePage = pages.find((page) => page.table2TitleY !== null)?.pageNumber;
            const afterTable2 = titlePages.filter((page) => !table2TitlePage || page.pageNumber >= table2TitlePage);
            return afterTable2[0] || titlePages[0] || null;
        }
        if (tableId === 'table_4') {
            const table3TitlePage = pages.find((page) => page.table3TitleY !== null)?.pageNumber;
            const afterTable3 = titlePages.filter((page) => !table3TitlePage || page.pageNumber >= table3TitlePage);
            return afterTable3[0] || titlePages[titlePages.length - 1] || null;
        }
        return titlePages[0] || null;
    }

    private pickVisualTablePages(
        pages: PdfVisualPageCandidate[],
        tableId: PdfVisualTableId
    ): number[] {
        const firstPage = this.pickVisualTablePage(pages, tableId);
        if (!firstPage) {
            return [];
        }
        if (tableId !== 'table_3') {
            return [firstPage];
        }
        const table4TitlePage = pages.find((page) => page.table4TitleY !== null)?.pageNumber;
        const nextPage = pages.find((page) => page.pageNumber === firstPage + 1);
        if (nextPage && (!table4TitlePage || nextPage.pageNumber < table4TitlePage)) {
            return [firstPage, nextPage.pageNumber];
        }
        return [firstPage];
    }

    private buildVisualTableAttemptPlans(
        pages: PdfVisualPageCandidate[],
        tableId: PdfVisualTableId
    ): number[][] {
        const primary = this.pickVisualTablePages(pages, tableId);
        const titlePage = this.pickVisualTableTitlePage(pages, tableId)?.pageNumber ?? null;
        const primaryFirst = primary[0] ?? null;
        const plans: Array<Array<number | null>> = [primary];

        if (tableId !== 'table_3') {
            plans.push([titlePage]);
            plans.push([titlePage, titlePage ? titlePage + 1 : null]);
            plans.push([primaryFirst]);
            plans.push([primaryFirst, primaryFirst ? primaryFirst + 1 : null]);
        } else {
            plans.push([primaryFirst]);
        }

        const imagePages = pages
            .filter((page) => page.imageCount > 0)
            .map((page) => page.pageNumber);
        if (tableId === 'table_2') {
            plans.push([imagePages[0] ?? null]);
            plans.push([imagePages[0] ?? null, imagePages[1] ?? null]);
            plans.push([imagePages[1] ?? null]);
        } else if (tableId === 'table_4') {
            plans.push([imagePages[imagePages.length - 1] ?? null]);
            plans.push([
                imagePages[Math.max(0, imagePages.length - 2)] ?? null,
                imagePages[imagePages.length - 1] ?? null,
            ]);
        }

        return this.dedupeVisualTablePlans(plans);
    }

    private dedupeVisualTablePlans(plans: Array<Array<number | null>>): number[][] {
        const seen = new Set<string>();
        const deduped: number[][] = [];
        for (const rawPlan of plans) {
            const normalized = [...new Set(rawPlan.filter((page): page is number => typeof page === 'number' && Number.isInteger(page) && page > 0))];
            if (!normalized.length) {
                continue;
            }
            const key = normalized.join('_');
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            deduped.push(normalized);
        }
        return deduped;
    }
    private async renderPdfPageToPng(absolutePath: string, pageNumber: number, tableId: PdfVisualTableId): Promise<string> {
        const canvasMod = await import('@napi-rs/canvas');
        const createCanvas = (canvasMod as any).createCanvas;
        const pdfjs = await loadPdfjs();
        const data = new Uint8Array(await fs.promises.readFile(absolutePath));
        const loadingTask = pdfjs.getDocument({
            data,
            disableWorker: true,
            isEvalSupported: false,
        });
        const pdf = await loadingTask.promise;
        try {
            const page = await pdf.getPage(pageNumber);
            const scale = Number(process.env.LLM_PARSE_PDF_VISUAL_RENDER_SCALE || 2);
            const viewport = page.getViewport({ scale: Number.isFinite(scale) && scale > 0 ? scale : 2 });
            const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
            const context = canvas.getContext('2d');
            await page.render({ canvasContext: context, viewport }).promise;

            const hash = await calculateFileHash(absolutePath);
            const outputDir = path.join(process.cwd(), 'tmp', 'pdf-visual-parse');
            fs.mkdirSync(outputDir, { recursive: true });
            const outputPath = path.join(outputDir, `${hash}-p${pageNumber}-${tableId}.png`);
            fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
            return outputPath;
        } finally {
            await pdf.destroy?.();
        }
    }

    private async renderPdfPagesToPng(
        absolutePath: string,
        pageNumbers: number[],
        tableId: PdfVisualTableId
    ): Promise<PdfRenderedImage | null> {
        const uniquePages = [...new Set(pageNumbers.filter((page) => Number.isInteger(page) && page > 0))];
        if (!uniquePages.length) {
            return null;
        }
        if (uniquePages.length === 1) {
            return {
                path: await this.renderPdfPageToPng(absolutePath, uniquePages[0], tableId),
                pageNumbers: uniquePages,
            };
        }

        const canvasMod = await import('@napi-rs/canvas');
        const createCanvas = (canvasMod as any).createCanvas;
        const pdfjs = await loadPdfjs();
        const data = new Uint8Array(await fs.promises.readFile(absolutePath));
        const loadingTask = pdfjs.getDocument({
            data,
            disableWorker: true,
            isEvalSupported: false,
        });
        const pdf = await loadingTask.promise;
        try {
            const scale = Number(process.env.LLM_PARSE_PDF_VISUAL_RENDER_SCALE || 2);
            const normalizedScale = Number.isFinite(scale) && scale > 0 ? scale : 2;
            const rendered = [];
            for (const pageNumber of uniquePages) {
                const page = await pdf.getPage(pageNumber);
                const viewport = page.getViewport({ scale: normalizedScale });
                const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
                const context = canvas.getContext('2d');
                await page.render({ canvasContext: context, viewport }).promise;
                rendered.push({ canvas, width: canvas.width, height: canvas.height });
            }

            const gap = 40;
            const width = Math.max(...rendered.map((item) => item.width));
            const height = rendered.reduce((sum, item) => sum + item.height, 0) + gap * (rendered.length - 1);
            const combined = createCanvas(width, height);
            const context = combined.getContext('2d');
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, width, height);
            let offsetY = 0;
            for (const item of rendered) {
                context.drawImage(item.canvas, Math.floor((width - item.width) / 2), offsetY);
                offsetY += item.height + gap;
            }

            const hash = await calculateFileHash(absolutePath);
            const outputDir = path.join(process.cwd(), 'tmp', 'pdf-visual-parse');
            fs.mkdirSync(outputDir, { recursive: true });
            const pageToken = uniquePages.join('-');
            const outputPath = path.join(outputDir, `${hash}-p${pageToken}-${tableId}.png`);
            fs.writeFileSync(outputPath, combined.toBuffer('image/png'));
            return { path: outputPath, pageNumbers: uniquePages };
        } finally {
            await pdf.destroy?.();
        }
    }

    private async requestVisualTableParse(tableId: PdfVisualTableId, imagePath: string, signal?: AbortSignal): Promise<Record<string, any>> {
        const dataUrl = this.buildImageDataUrl(imagePath);
        const response = await axios.post(
            `${this.baseURL.replace(/\/+$/, '')}/responses`,
            {
                model: this.model,
                input: [
                    {
                        role: 'system',
                        content: 'You extract visible Chinese government annual report table cells into strict JSON. Return only valid JSON. Never infer invisible values.',
                    },
                    {
                        role: 'user',
                        content: [
                            { type: 'input_text', text: this.buildVisualTablePrompt(tableId) },
                            { type: 'input_image', image_url: dataUrl, detail: 'high' },
                        ],
                    },
                ],
                temperature: 0,
                max_output_tokens: tableId === 'table_3' ? 4096 : 2048,
                store: false,
                reasoning: this.buildReasoningConfig(this.resolveParseReasoningEffort()),
                text: {
                    format: {
                        type: 'json_schema',
                        name: `pdf_visual_${tableId}_parse`,
                        schema: this.buildVisualTableSchema(tableId),
                        strict: false,
                    },
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                responseType: 'text',
                signal,
                timeout: this.resolveRequestTimeoutMs(Number(process.env.LLM_PARSE_PDF_VISUAL_TIMEOUT_MS || 120000)),
                transformResponse: [(data) => data],
                validateStatus: () => true,
            }
        );

        if (response.status >= 400) {
            throw this.normalizeError({
                response: { status: response.status, data: response.data },
                status: response.status,
                message: String(response.data || ''),
            });
        }

        const raw = String(response.data || '').trim();
        const parsedEnvelope = parseStructuredJsonFromText<any>(raw);
        const text = this.extractResponseText(parsedEnvelope) || raw;
        return parseStructuredJsonFromText<Record<string, any>>(text);
    }

    private buildImageDataUrl(imagePath: string): string {
        const buffer = fs.readFileSync(imagePath);
        return `data:image/png;base64,${buffer.toString('base64')}`;
    }

    private async parseVisualTablesFromPdf(
        absolutePath: string,
        candidates: PdfVisualPageCandidate[],
        tableIds: PdfVisualTableId[],
        signal?: AbortSignal
    ): Promise<{
        table2: Record<string, any> | null;
        table3: Record<string, any> | null;
        table4: Table4ParseResponse['reviewLitigationData'];
        repairs: string[];
        attempts: PdfVisualTableAttempt[];
    }> {
        const result = {
            table2: null as Record<string, any> | null,
            table3: null as Record<string, any> | null,
            table4: null as Table4ParseResponse['reviewLitigationData'],
            repairs: [] as string[],
            attempts: [] as PdfVisualTableAttempt[],
        };

        for (const tableId of tableIds) {
            const pagePlans = this.buildVisualTableAttemptPlans(candidates, tableId);
            if (!pagePlans.length) {
                result.attempts.push({ tableId, pageNumbers: [], status: 'no_candidate' });
                continue;
            }
            for (const pageNumbers of pagePlans) {
                const rendered = await this.renderPdfPagesToPng(absolutePath, pageNumbers, tableId);
                if (!rendered) {
                    result.attempts.push({ tableId, pageNumbers, status: 'render_unavailable' });
                    continue;
                }
                let ocr: Record<string, any>;
                try {
                    ocr = await this.requestVisualTableParse(tableId, rendered.path, signal);
                } catch {
                    result.attempts.push({ tableId, pageNumbers: rendered.pageNumbers, status: 'request_failed' });
                    continue;
                }
                const payload = this.extractVisualPayload(ocr, tableId);
                if (!payload || !hasMeaningfulLeaf(payload)) {
                    result.attempts.push({ tableId, pageNumbers: rendered.pageNumbers, status: 'empty_payload' });
                    continue;
                }
                if (tableId === 'table_2') result.table2 = payload;
                if (tableId === 'table_3') result.table3 = payload;
                if (tableId === 'table_4') result.table4 = payload as Table4ParseResponse['reviewLitigationData'];
                result.repairs.push(`pdf_visual_${tableId}_page_${rendered.pageNumbers.join('_')}`);
                result.attempts.push({ tableId, pageNumbers: rendered.pageNumbers, status: 'success' });
                break;
            }
        }

        return result;
    }

    private buildVisualTablePrompt(tableId: PdfVisualTableId): string {
        if (tableId === 'table_2') {
            return [
                'Extract ????????????? from this PDF page image.',
                'Return JSON with top-level key activeDisclosureData.',
                'Map rows to regulations, normativeDocuments, licensing, punishment, coercion, and fees.',
                'For regulations and normativeDocuments, return made, repealed, valid.',
                'For licensing, punishment, and coercion, return processed.',
                'For fees, return amount.',
                'Use numbers for numeric cells. Use null only for blank/unreadable cells. Preserve "/" or "-" markers as strings.',
            ].join('\n');
        }
        if (tableId === 'table_3') {
            return [
                'Extract 表三：收到和处理政府信息公开申请情况 from this PDF page image.',
                'Return JSON with top-level key tableData using this exact skeleton:',
                JSON.stringify(buildTable3Skeleton()),
                'Use numbers for numeric cells. Use null only for blank/unreadable cells. Preserve "/" or "-" markers as strings.',
            ].join('\n');
        }
        return [
            'Extract 表四：政府信息公开行政复议、行政诉讼情况 from this PDF page image.',
            'Return JSON with top-level key reviewLitigationData.',
            'Map the first 5 result cells to review, the next 5 to litigationDirect, and the final 5 to litigationPostReview.',
            'Each block must contain maintain, correct, other, unfinished, total.',
            'Use numbers for numeric cells. Use null only for blank/unreadable cells. Preserve "/" or "-" markers as strings.',
        ].join('\n');
    }

    private buildVisualTableSchema(tableId: PdfVisualTableId): Record<string, unknown> {
        if (tableId === 'table_2') {
            const cell = { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }] };
            return {
                type: 'object',
                required: ['activeDisclosureData'],
                additionalProperties: true,
                properties: {
                    activeDisclosureData: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {
                            regulations: {
                                type: 'object',
                                additionalProperties: true,
                                properties: { made: cell, repealed: cell, valid: cell },
                            },
                            normativeDocuments: {
                                type: 'object',
                                additionalProperties: true,
                                properties: { made: cell, repealed: cell, valid: cell },
                            },
                            licensing: {
                                type: 'object',
                                additionalProperties: true,
                                properties: { processed: cell },
                            },
                            punishment: {
                                type: 'object',
                                additionalProperties: true,
                                properties: { processed: cell },
                            },
                            coercion: {
                                type: 'object',
                                additionalProperties: true,
                                properties: { processed: cell },
                            },
                            fees: {
                                type: 'object',
                                additionalProperties: true,
                                properties: { amount: cell },
                            },
                        },
                    },
                },
            };
        }
        if (tableId === 'table_3') {
            return {
                type: 'object',
                required: ['tableData'],
                additionalProperties: true,
                properties: {
                    tableData: { type: 'object', additionalProperties: true },
                },
            };
        }
        const cell = { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }] };
        const block = {
            type: 'object',
            required: ['maintain', 'correct', 'other', 'unfinished', 'total'],
            additionalProperties: true,
            properties: {
                maintain: cell,
                correct: cell,
                other: cell,
                unfinished: cell,
                total: cell,
            },
        };
        return {
            type: 'object',
            required: ['reviewLitigationData'],
            additionalProperties: true,
            properties: {
                reviewLitigationData: {
                    type: 'object',
                    required: ['review', 'litigationDirect', 'litigationPostReview'],
                    additionalProperties: true,
                    properties: {
                        review: block,
                        litigationDirect: block,
                        litigationPostReview: block,
                    },
                },
            },
        };
    }

    private extractVisualPayload(ocr: Record<string, any>, tableId: PdfVisualTableId): Record<string, any> | null {
        const key = this.payloadKeyForTable(tableId);
        const payload = ocr?.[key] || ocr?.[tableId];
        if (tableId === 'table_2') {
            const normalized = normalizeTable2ParseResponse({ activeDisclosureData: payload }).activeDisclosureData;
            return isPlainObject(normalized) && hasMeaningfulLeaf(normalized) ? normalized : null;
        }
        if (tableId === 'table_4') {
            const normalized = normalizeTable4ParseResponse({ reviewLitigationData: payload }).reviewLitigationData;
            return normalized && hasMeaningfulLeaf(normalized) ? normalized as Record<string, any> : null;
        }
        const normalized = normalizeTable3ParseResponse({ tableData: payload }).tableData;
        return isPlainObject(normalized) && hasMeaningfulLeaf(normalized) ? normalized : null;
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

    private resolveParseReasoningEffort(): string {
        return String(
            process.env.LLM_PARSE_OPENAI_REASONING_EFFORT ||
            process.env.LLM_PARSE_REASONING_EFFORT ||
            'low'
        ).trim().toLowerCase();
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
            reasoningEffort?: string;
        },
        label: string,
        signal?: AbortSignal
    ): Promise<T> {
        const text = await this.requestText(config, signal);
        if (OPENAI_DEBUG_LOGS) {
            console.log(`[OpenAI] ${label} response preview:`, text.slice(0, 500));
        }

        try {
            return parseStructuredJsonFromText<T>(text);
        } catch (error: any) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new LlmProviderError(`OpenAI ${label} returned invalid JSON: ${reason}`, 'json_parse_error');
        }
    }

    async generate(prompt: string, systemInstruction?: string, config?: any): Promise<any> {
        try {
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
                apiMode: config?.apiMode,
                reasoningEffort: config?.reasoningEffort,
            });

            return { text };
        } catch (error) {
            throw this.normalizeError(error);
        }
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
            apiMode?: string;
            reasoningEffort?: string;
        },
        signal?: AbortSignal
    ): Promise<string> {
        const maxAttempts = this.resolveTransientRetryAttempts();
        let lastError: any = null;
        const apiMode = this.resolveApiMode(config.apiMode);

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                if (apiMode === 'chat_completions') {
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
        reasoningEffort?: string;
        timeoutMs?: number;
    }, signal?: AbortSignal): Promise<string> {
        let firstError: any = null;
        const requestTimeoutMs = this.resolveRequestTimeoutMs(config.timeoutMs);
        const { signal: scopedSignal, dispose } = this.createScopedAbortSignal(signal, requestTimeoutMs);

        try {
            if (this.shouldPreferRawResponses()) {
                return await this.requestTextViaRawResponses(config, scopedSignal, requestTimeoutMs);
            }

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
                    reasoning: this.buildReasoningConfig(config.reasoningEffort),
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

    private shouldPreferRawResponses(): boolean {
        return !/api\.openai\.com/i.test(this.baseURL);
    }

    private async requestTextViaChatCompletions(config: {
        prompt: string;
        systemInstruction?: string;
        temperature?: number;
        maxOutputTokens?: number;
        responseMimeType?: string;
        responseSchema?: unknown;
        responseSchemaName?: string;
        responseSchemaDescription?: string;
        responseStrict?: boolean;
        reasoningEffort?: string;
        timeoutMs?: number;
    }, signal?: AbortSignal): Promise<string> {
        const requestTimeoutMs = this.resolveRequestTimeoutMs(config.timeoutMs);
        const { signal: scopedSignal, dispose } = this.createScopedAbortSignal(signal, requestTimeoutMs);

        try {
            if (this.shouldPreferRawChatCompletions()) {
                return await this.requestTextViaRawChatCompletions(config, scopedSignal, requestTimeoutMs);
            }

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

                const text = this.extractChatCompletionText(response);
                if (text) {
                    return text;
                }

                console.warn('[OpenAI] Chat Completions SDK returned no content, retrying via raw HTTP fallback.');
            } catch (error) {
                const normalized = this.normalizeError(error);
                if (normalized.code !== 'openai_empty_response') {
                    throw normalized;
                }
                console.warn('[OpenAI] Chat Completions SDK returned empty content, retrying via raw HTTP fallback.');
            }

            return await this.requestTextViaRawChatCompletions(config, scopedSignal, requestTimeoutMs);
        } finally {
            dispose();
        }
    }

    private shouldPreferRawChatCompletions(): boolean {
        return !/api\.openai\.com/i.test(this.baseURL);
    }

    private extractChatCompletionText(response: any): string {
        const content = response?.choices?.[0]?.message?.content;
        if (typeof content === 'string') {
            return content.trim();
        }

        if (Array.isArray(content)) {
            return content
                .map((item) => {
                    if (typeof item === 'string') return item;
                    if (item?.type === 'text' && typeof item?.text === 'string') return item.text;
                    return '';
                })
                .join('')
                .trim();
        }

        return '';
    }

    private async requestTextViaRawChatCompletions(config: {
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
        const url = `${this.baseURL.replace(/\/+$/, '')}/chat/completions`;
        const response = await axios.post(
            url,
            {
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
            },
            {
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                responseType: 'text',
                signal,
                timeout: requestTimeoutMs ?? this.resolveRequestTimeoutMs(config.timeoutMs),
                transformResponse: [(data) => data],
                validateStatus: () => true,
            }
        );

        if (response.status >= 400) {
            throw this.normalizeError({
                response: {
                    status: response.status,
                    data: response.data,
                },
                status: response.status,
                message: String(response.data || ''),
            });
        }

        const raw = String(response.data || '').trim();
        if (!raw) {
            throw new LlmProviderError('OpenAI raw chat completion missing content', 'openai_empty_response');
        }

        try {
            const parsed = JSON.parse(raw);
            const text = this.extractChatCompletionText(parsed);
            if (text) {
                return text;
            }
        } catch {
            // Fall through to plain-text/SSE parsing.
        }

        const sseText = this.extractResponseTextFromSse(raw);
        if (sseText) {
            return sseText;
        }

        throw new LlmProviderError('OpenAI raw chat completion missing content', 'openai_empty_response');
    }

    private async requestTextViaRawResponses(config: {
        prompt: string;
        systemInstruction?: string;
        temperature?: number;
        maxOutputTokens?: number;
        responseMimeType?: string;
        responseSchema?: unknown;
        responseSchemaName?: string;
        responseSchemaDescription?: string;
        responseStrict?: boolean;
        reasoningEffort?: string;
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
                reasoning: this.buildReasoningConfig(config.reasoningEffort),
                text: this.buildResponsesTextConfig(config),
            },
            {
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                responseType: 'text',
                signal,
                timeout: requestTimeoutMs ?? this.resolveRequestTimeoutMs(config.timeoutMs),
                transformResponse: [(data) => data],
                validateStatus: () => true,
            }
        );

        if (response.status >= 400) {
            throw this.normalizeError({
                response: {
                    status: response.status,
                    data: response.data,
                },
                status: response.status,
                message: String(response.data || ''),
            });
        }

        const raw = String(response.data || '').trim();
        if (!raw) {
            throw new LlmProviderError('OpenAI raw response missing content', 'openai_empty_response');
        }

        try {
            const parsed = JSON.parse(raw);
            const text = this.extractResponseText(parsed);
            if (text) {
                return text;
            }
        } catch {
            // Fall through to plain-text/SSE parsing.
        }

        const sseText = this.extractResponseTextFromSse(raw);
        if (sseText) {
            return sseText;
        }

        throw new LlmProviderError('OpenAI raw response missing content', 'openai_empty_response');
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

    private buildChatResponseFormat(config: {
        responseMimeType?: string;
        responseSchema?: unknown;
        responseSchemaName?: string;
        responseSchemaDescription?: string;
        responseStrict?: boolean;
    }): any {
        if (config.responseSchema) {
            return {
                type: 'json_schema',
                json_schema: {
                    name: config.responseSchemaName || 'structured_output',
                    description: config.responseSchemaDescription,
                    schema: config.responseSchema,
                    strict: config.responseStrict ?? false,
                },
            };
        }

        const requestedMime = String(config.responseMimeType || '').toLowerCase();
        if (requestedMime.includes('json') || (process.env.OPENAI_RESPONSE_FORMAT || '').trim().toLowerCase() === 'json_object') {
            return { type: 'json_object' };
        }
        return undefined;
    }

    private buildReasoningConfig(preferredEffort?: string): { effort: string } | undefined {
        const effort = String(preferredEffort || process.env.OPENAI_REASONING_EFFORT || '').trim().toLowerCase();
        if (!effort) {
            return undefined;
        }
        if (!['minimal', 'low', 'medium', 'high', 'xhigh'].includes(effort)) {
            return undefined;
        }
        return { effort };
    }

    private resolveApiMode(preferredMode?: string): string {
        const mode = String(preferredMode || this.apiMode || 'responses').trim().toLowerCase();
        return mode === 'chat_completions' ? 'chat_completions' : 'responses';
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
        reasoningEffort?: string;
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
                reasoning: this.buildReasoningConfig(config.reasoningEffort),
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
            const code = String(error.code || '').toLowerCase();
            return (
                code === 'openai_empty_response' ||
                code === 'openai_timeout' ||
                code === 'openai_http_error' ||
                code === 'openai_request_error' ||
                code === 'openai_connection_refused' ||
                code === 'quota_exceeded'
            );
        }

        const status = Number(error?.status || error?.response?.status || 0);
        if (status === 429 || status === 524 || status >= 500) {
            return true;
        }
        if (status >= 400 && status < 500) {
            return false;
        }

        const code = String(error?.code || '').toUpperCase();
        if (['ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE', 'ECONNABORTED', 'ETIMEDOUT'].includes(code)) {
            return true;
        }

        const message = String(error?.message || '').toLowerCase();
        return (
            message.includes('client network socket disconnected before secure tls connection was established') ||
            message.includes('socket hang up') ||
            message.includes('connection error') ||
            message.includes('network error') ||
            message.includes('fetch failed') ||
            message.includes('timeout') ||
            message.includes('timed out') ||
            message.includes('524')
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
                'openai_timeout'
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
