import fs from 'fs';
import path from 'path';
import { LlmParseRequest } from './LlmProvider';
import PdfParseService from './PdfParseService';
import HtmlParseService from './HtmlParseService';

export interface LoadedContent {
    text: string;
    metadata: {
        visual_border_missing?: boolean;
        format?: string;
    };
}

export function stripMarkdownJsonFences(text: string): string {
    return String(text || '')
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();
}

export function buildTable3Skeleton(): any {
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

export function buildSystemInstruction(): string {
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
        '=== CRITICAL DATA EXTRACTION RULES ===',
        'For ALL table cells (table_2, table_3, table_4):',
        '1. If a cell contains a NUMBER, extract it as a number (integer).',
        '2. If a cell contains "/" or "-" or "—", extract it AS THE STRING "/" or "-" or "—". DO NOT convert to 0.',
        '3. If a cell is BLANK or EMPTY, extract it as null or empty string "". DO NOT convert to 0.',
        '4. Only use 0 when the cell explicitly shows "0".',
        '',
        'This is CRITICAL for data quality auditing. We need to distinguish between:',
        '- A cell that explicitly has value 0',
        '- A cell that is blank/empty (represents missing data)',
        '- A cell that contains "/" or "-" (represents not applicable)',
        '',
        'CRITICAL for table_3 (Structure below):',
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

export async function loadUserText(absolutePath: string, request: LlmParseRequest): Promise<LoadedContent> {
    const lower = absolutePath.toLowerCase();

    // PDF Handling
    if (lower.endsWith('.pdf')) {
        try {
            const parsed = await PdfParseService.parsePDF(absolutePath, String(request.reportId));
            if (parsed.success && parsed.document?.extracted_text) {
                return {
                    text: parsed.document.extracted_text,
                    metadata: {
                        visual_border_missing: parsed.document.metadata.visual_border_missing,
                        format: 'pdf'
                    }
                };
            }
            return { text: `PDF parse failed. File metadata: ${JSON.stringify(request)}`, metadata: {} };
        } catch (e) {
            return { text: `PDF parse threw exception. File metadata: ${JSON.stringify(request)}`, metadata: {} };
        }
    }

    // HTML Handling
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
        const parsed = await HtmlParseService.parseHtml(absolutePath);
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
            return { text: content, metadata: { format: 'text' } };
        } catch (error) {
            return { text: `Text read failed. File metadata: ${JSON.stringify(request)}`, metadata: {} };
        }
    }

    return { text: `Unsupported file extension. File metadata: ${JSON.stringify(request)}`, metadata: {} };
}
