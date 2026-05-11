import fs from 'fs/promises';
import * as cheerio from 'cheerio';

export interface HtmlParseResult {
    success: boolean;
    extracted_text?: string;
    metadata?: {
        visual_border_missing?: boolean;
        missing_table_3?: boolean;
        content_selector?: string;
        content_score?: number;
        content_noise_terms?: number;
    };
    error?: string;
}

/**
 * 识别表格类型（表二、表三、表四）
 * 基于表格关键字判断
 */
function identifyTableType(tableText: string): { type: string; title: string } | null {
    const text = tableText.toLowerCase();

    // 表四：行政复议、行政诉讼
    if (text.includes('行政复议') || text.includes('行政诉讼') || text.includes('复议') && text.includes('诉讼')) {
        return { type: 'table_4', title: '## 表四：政府信息公开行政复议、行政诉讼情况' };
    }

    // 表三：申请情况（包含特征关键词）
    if (text.includes('本年新收') || text.includes('上年结转') || text.includes('予以公开') ||
        text.includes('部分公开') || text.includes('不予公开') || text.includes('自然人') && text.includes('法人')) {
        return { type: 'table_3', title: '## 表三：收到和处理政府信息公开申请情况' };
    }

    // 表二：主动公开情况
    if (text.includes('规章') || text.includes('规范性文件') || text.includes('行政许可') ||
        text.includes('行政处罚') || text.includes('行政强制') || text.includes('第二十条')) {
        return { type: 'table_2', title: '## 表二：主动公开政府信息情况' };
    }

    return null;
}

/**
 * 将HTML表格转换为Markdown格式
 * 处理colspan和rowspan，保持结构完整
 */
function convertTableToMarkdown($: any, table: cheerio.Element): string {
    const rows: string[][] = [];
    const $table = $(table);

    // 创建一个二维矩阵来处理rowspan
    const matrix: (string | null)[][] = [];
    let maxCols = 0;

    $table.find('tr').each((rowIdx: number, tr: cheerio.Element) => {
        if (!matrix[rowIdx]) matrix[rowIdx] = [];

        let colIdx = 0;
        $(tr).find('td, th').each((_: number, cell: cheerio.Element) => {
            const $cell = $(cell);
            const text = $cell.text().trim().replace(/\s+/g, ' ');
            const colspan = parseInt($cell.attr('colspan') || '1', 10);
            const rowspan = parseInt($cell.attr('rowspan') || '1', 10);

            // 找到下一个可用的列位置（跳过被rowspan占用的）
            while (matrix[rowIdx][colIdx] !== undefined) {
                colIdx++;
            }

            // 填充colspan
            for (let c = 0; c < colspan; c++) {
                // 填充rowspan
                for (let r = 0; r < rowspan; r++) {
                    if (!matrix[rowIdx + r]) matrix[rowIdx + r] = [];
                    matrix[rowIdx + r][colIdx + c] = (r === 0 && c === 0) ? text : '';
                }
            }

            colIdx += colspan;
        });

        maxCols = Math.max(maxCols, matrix[rowIdx].length);
    });

    // 统一列数
    matrix.forEach(row => {
        while (row.length < maxCols) {
            row.push('');
        }
    });

    // 检测是否是表四（多层复杂表头）
    const flatText = matrix.map(r => r.join(' ')).join(' ');
    const isTable4 = flatText.includes('行政复议') && flatText.includes('行政诉讼');

    if (isTable4) {
        // 表四特殊处理：拆分为多个子表格
        return convertTable4ToMarkdown(matrix);
    }

    // 普通表格：转换为Markdown
    const tableInfo = identifyTableType(flatText);
    let result = '';

    if (tableInfo) {
        result += `\n${tableInfo.title}\n\n`;
    }

    if (matrix.length > 0) {
        // 第一行作为表头
        result += '| ' + matrix[0].map(c => c ?? '').join(' | ') + ' |\n';
        result += '|' + matrix[0].map(() => '---').join('|') + '|\n';

        // 数据行
        for (let i = 1; i < matrix.length; i++) {
            const row = matrix[i].map(c => c ?? '');
            result += '| ' + row.join(' | ') + ' |\n';
        }
    }

    return result;
}

/**
 * 表四特殊处理：拆分为三个独立的子表格
 */
function convertTable4ToMarkdown(matrix: (string | null)[][]): string {
    let result = '\n## 表四：政府信息公开行政复议、行政诉讼情况\n\n';

    // 寻找数据行（通常是最后一行包含所有数字）
    let dataRow: string[] = [];
    for (let i = matrix.length - 1; i >= 0; i--) {
        const row = matrix[i];
        const numericCount = row.filter(c => /^\d+$/.test(c || '')).length;
        if (numericCount >= 5) {
            dataRow = row.map(c => c ?? '');
            break;
        }
    }

    if (dataRow.length >= 15) {
        // 标准表四格式：行政复议(5列) + 未经复议直接起诉(5列) + 复议后起诉(5列)
        const headers = ['结果维持', '结果纠正', '其他结果', '尚未审结', '总计'];

        result += '### 行政复议\n';
        result += '| ' + headers.join(' | ') + ' |\n';
        result += '|' + headers.map(() => '---').join('|') + '|\n';
        result += '| ' + dataRow.slice(0, 5).join(' | ') + ' |\n\n';

        result += '### 行政诉讼（未经复议直接起诉）\n';
        result += '| ' + headers.join(' | ') + ' |\n';
        result += '|' + headers.map(() => '---').join('|') + '|\n';
        result += '| ' + dataRow.slice(5, 10).join(' | ') + ' |\n\n';

        result += '### 行政诉讼（复议后起诉）\n';
        result += '| ' + headers.join(' | ') + ' |\n';
        result += '|' + headers.map(() => '---').join('|') + '|\n';
        result += '| ' + dataRow.slice(10, 15).join(' | ') + ' |\n';
    } else {
        // 数据不足，回退到普通格式
        result += '| ' + matrix[0]?.map(c => c ?? '').join(' | ') + ' |\n';
        result += '|' + (matrix[0] || []).map(() => '---').join('|') + '|\n';
        for (let i = 1; i < matrix.length; i++) {
            result += '| ' + matrix[i].map(c => c ?? '').join(' | ') + ' |\n';
        }
    }

    return result;
}

type ContentCandidate = {
    selector: string;
    html: string;
    textLength: number;
    markerCount: number;
    tableCount: number;
    noiseTerms: number;
    score: number;
};

const CONTENT_CONTAINER_SELECTORS: Array<{ selector: string; boost: number }> = [
    { selector: '#ivs_content', boost: 120 },
    { selector: '#webeditorview', boost: 100 },
    { selector: '#zoom', boost: 90 },
    { selector: '#Zoom', boost: 90 },
    { selector: '#article', boost: 85 },
    { selector: '#articleContent', boost: 85 },
    { selector: '#article_content', boost: 85 },
    { selector: '#mainContent', boost: 75 },
    { selector: '#content', boost: 60 },
    { selector: '#Content', boost: 60 },
    { selector: 'article', boost: 80 },
    { selector: 'main', boost: 60 },
    { selector: '.TRS_Editor', boost: 100 },
    { selector: '.trs_editor', boost: 100 },
    { selector: '.Custom_UnionStyle', boost: 95 },
    { selector: '.webeditorview', boost: 95 },
    { selector: '.article-content', boost: 85 },
    { selector: '.articleContent', boost: 85 },
    { selector: '.article_content', boost: 85 },
    { selector: '.article-cont', boost: 80 },
    { selector: '.articleCont', boost: 80 },
    { selector: '.detail-content', boost: 80 },
    { selector: '.content-detail', boost: 80 },
    { selector: '.xxgk_content', boost: 80 },
    { selector: '.zw-content', boost: 75 },
    { selector: '.main-content', boost: 70 }
];

const ANNUAL_REPORT_MARKERS = [
    '政府信息公开工作年度报告',
    '一、总体情况',
    '二、主动公开政府信息情况',
    '三、收到和处理政府信息公开申请情况',
    '四、政府信息公开行政复议、行政诉讼情况',
    '五、存在的主要问题及改进情况',
    '六、其他需要报告的事项',
    '主动公开政府信息情况',
    '收到和处理政府信息公开申请情况',
    '政府信息公开行政复议、行政诉讼情况',
    '存在的主要问题及改进情况',
    '其他需要报告的事项'
];

const HTML_NOISE_TERMS = [
    '繁體版',
    'ENGLISH',
    '日本語',
    '한국어',
    'FRANÇAIS',
    '无障碍',
    '长者版',
    '退出关怀版',
    '首页',
    '当前位置',
    '字体：',
    '大 中 小',
    '一网通办',
    '专题专栏',
    '分享到',
    '打印',
    '关闭',
    '返回顶部',
    '网站地图',
    '友情链接',
    '主办单位',
    'ICP备案',
    '公安备案'
];

const PAGE_CHROME_SELECTOR = [
    'script',
    'style',
    'noscript',
    'template',
    'iframe',
    'svg',
    'canvas',
    'form',
    'button',
    'input',
    'select',
    'textarea',
    'header',
    'footer',
    'nav',
    'aside',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '.breadcrumb',
    '.breadcrumbs',
    '.crumb',
    '.location',
    '.position',
    '.share',
    '.share-box',
    '.toolbar',
    '.tools',
    '.article-tools',
    '.fontsize',
    '.font-size',
    '.print',
    '.search',
    '.sitemap',
    '.language',
    '.lang',
    '#header',
    '#footer',
    '#nav',
    '#menu',
    '#search',
    '#breadcrumb'
].join(',');

const BLOCK_TEXT_SELECTOR = [
    'address',
    'article',
    'blockquote',
    'dd',
    'div',
    'dl',
    'dt',
    'figcaption',
    'figure',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'li',
    'main',
    'ol',
    'p',
    'pre',
    'section',
    'table',
    'tr',
    'ul'
].join(',');

function normalizeTextForScoring(raw: string): string {
    return raw
        .replace(/\u00a0/g, ' ')
        .replace(/\u3000/g, ' ')
        .replace(/[ \t\r\n\f\v]+/g, ' ')
        .trim();
}

function countOccurrences(text: string, term: string): number {
    if (!term) return 0;
    let count = 0;
    let index = text.indexOf(term);
    while (index !== -1) {
        count++;
        index = text.indexOf(term, index + term.length);
    }
    return count;
}

function countNoiseTerms(text: string): number {
    return HTML_NOISE_TERMS.reduce((total, term) => total + countOccurrences(text, term), 0);
}

function countReportMarkers(text: string): number {
    return ANNUAL_REPORT_MARKERS.reduce((total, marker) => total + (text.includes(marker) ? 1 : 0), 0);
}

function scoreContentCandidate($: any, element: cheerio.Element, selector: string, selectorBoost: number): ContentCandidate | null {
    const $element = $(element);
    const text = normalizeTextForScoring($element.text());
    const textLength = text.length;
    if (textLength < 80) {
        return null;
    }

    const markerCount = countReportMarkers(text);
    const tableCount = $element.find('table').length;
    const noiseTerms = countNoiseTerms(text);
    const noiseDensity = textLength > 0 ? noiseTerms / textLength : 0;
    const hasAnnualReportTitle = text.includes('政府信息公开工作年度报告');
    const hasMainBody = markerCount >= 2 || /[一二三四五六]、/.test(text);
    let score = selectorBoost;

    if (hasAnnualReportTitle) score += 140;
    if (hasMainBody) score += 50;
    score += markerCount * 45;
    score += Math.min(tableCount, 4) * 20;
    if (textLength >= 300) score += 25;
    if (textLength >= 800 && textLength <= 50000) score += 20;
    if (selector === 'body' || selector === 'html') score -= 60;
    if (textLength > 20000 && markerCount < 4) score -= 90;
    if (textLength > 50000) score -= 80;
    score -= noiseTerms * 18;
    score -= Math.max(0, noiseDensity - 0.0015) * 20000;

    const html = $.html(element);
    if (!html) {
        return null;
    }

    return {
        selector,
        html,
        textLength,
        markerCount,
        tableCount,
        noiseTerms,
        score
    };
}

function looksLikeContentContainer($: any, element: cheerio.Element): boolean {
    const $element = $(element);
    const id = $element.attr('id') || '';
    const className = $element.attr('class') || '';
    const attr = `${id} ${className}`.toLowerCase();
    if (/(article|content|detail|main|zoom|webeditor|trs|ivs|xxgk|zw)/i.test(attr)) {
        return true;
    }

    const text = normalizeTextForScoring($element.text());
    return text.includes('政府信息公开工作年度报告') && countReportMarkers(text) >= 2;
}

function selectContentCandidate($: any): ContentCandidate {
    const candidates: ContentCandidate[] = [];
    const seen = new Set<string>();

    const addCandidate = (element: cheerio.Element, selector: string, boost: number): void => {
        const candidate = scoreContentCandidate($, element, selector, boost);
        if (!candidate) {
            return;
        }
        const fingerprint = `${candidate.textLength}:${candidate.html.slice(0, 500)}`;
        if (seen.has(fingerprint)) {
            return;
        }
        seen.add(fingerprint);
        candidates.push(candidate);
    };

    for (const { selector, boost } of CONTENT_CONTAINER_SELECTORS) {
        $(selector).each((index: number, element: cheerio.Element) => {
            addCandidate(element, `${selector}${index > 0 ? `[${index}]` : ''}`, boost);
        });
    }

    $('body *').each((_: number, element: cheerio.Element) => {
        if (looksLikeContentContainer($, element)) {
            addCandidate(element, 'auto-content', 35);
        }
    });

    const body = $('body').get(0);
    if (body) {
        addCandidate(body, 'body', 0);
    }

    if (candidates.length === 0) {
        return {
            selector: 'root',
            html: $.root().html() || '',
            textLength: normalizeTextForScoring($.root().text()).length,
            markerCount: 0,
            tableCount: $('table').length,
            noiseTerms: countNoiseTerms(normalizeTextForScoring($.root().text())),
            score: 0
        };
    }

    candidates.sort((a, b) => {
        const scoreDelta = b.score - a.score;
        if (Math.abs(scoreDelta) > 15) {
            return scoreDelta;
        }
        const markerDelta = b.markerCount - a.markerCount;
        if (markerDelta !== 0) {
            return markerDelta;
        }
        const noiseDelta = a.noiseTerms - b.noiseTerms;
        if (noiseDelta !== 0) {
            return noiseDelta;
        }
        return a.textLength - b.textLength;
    });

    return candidates[0];
}

function removePageChrome($: any): void {
    $(PAGE_CHROME_SELECTOR).remove();
}

function addStructuralTextBreaks($: any): void {
    $('br').replaceWith('\n');
    $(BLOCK_TEXT_SELECTOR).each((_: number, element: cheerio.Element) => {
        const $element = $(element);
        $element.prepend('\n');
        $element.append('\n');
    });
}

function cleanExtractedText(raw: string): string {
    return raw
        .replace(/\r\n?/g, '\n')
        .replace(/\u00a0/g, ' ')
        .replace(/\u3000/g, ' ')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/[ \t]*\n[ \t]*/g, '\n')
        .replace(/(政府信息公开工作年度报告)\s*([一二三四五六]、)/g, '$1\n$2')
        .replace(/([^\n])([一二三四五六]、(?:总体情况|主动公开政府信息情况|收到和处理政府信息公开申请情况|政府信息公开行政复议、行政诉讼情况|存在的主要问题及改进情况|其他需要报告的事项))/g, '$1\n$2')
        .replace(/([^\n])([（(][一二三四五六][）)](?:主动公开|依申请公开|政府信息公开行政复议|存在的主要问题|改进情况|贯彻落实|收取信息处理费))/g, '$1\n$2')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function extractTextFromCandidate(candidate: ContentCandidate): string {
    const $$ = cheerio.load(candidate.html);
    removePageChrome($$);

    $$('table').each((_: number, table: cheerio.Element) => {
        const markdownTable = convertTableToMarkdown($$, table);
        $$(table).replaceWith(`\n${markdownTable}\n`);
    });

    addStructuralTextBreaks($$);
    return cleanExtractedText($$.root().text());
}

export class HtmlParseService {
    async parseHtmlToMarkdown(filePath: string): Promise<HtmlParseResult> {
        return this.parseHtml(filePath);
    }

    async parseHtml(filePath: string): Promise<HtmlParseResult> {
        try {
            const fileBuffer = await fs.readFile(filePath);

            // Detect Encoding
            // 1. Check for UTF-8 BOM
            let encoding = 'utf-8';
            if (fileBuffer[0] === 0xEF && fileBuffer[1] === 0xBB && fileBuffer[2] === 0xBF) {
                encoding = 'utf-8';
            } else {
                // 2. Peek for charset in meta tags (common in older Chinese sites)
                const head = fileBuffer.subarray(0, 4096).toString('binary');
                const charsetMatch = head.match(/<meta[^>]+charset=["']?([a-zA-Z0-9-]+)["']?/i);
                if (charsetMatch) {
                    const detected = charsetMatch[1].toLowerCase();
                    if (['gbk', 'gb2312', 'gb18030'].includes(detected)) {
                        encoding = 'gbk';
                    }
                }
            }

            let content = '';
            try {
                const decoder = new TextDecoder(encoding);
                content = decoder.decode(fileBuffer);
            } catch {
                const decoder = new TextDecoder('utf-8');
                content = decoder.decode(fileBuffer);
            }
            const $ = cheerio.load(content);

            // Remove non-content tags that should never be sent to LLM.
            removePageChrome($);

            // 1. Visual Audit: Border Detection (Perform on original DOM)
            let visual_border_missing = false;
            const tables = $('table');
            if (tables.length > 0) {
                let borderlessCount = 0;
                tables.each((_, el) => {
                    const table = $(el);
                    const borderAttr = table.attr('border');
                    const styleAttr = table.attr('style') || '';

                    const hasNoBorderAttr = borderAttr === '0';
                    const hasNoBorderStyle = styleAttr.includes('border:none') || styleAttr.includes('border: none') || styleAttr.includes('border:0');
                    if (table.find('tr').length > 3 && (hasNoBorderAttr || hasNoBorderStyle)) {
                        borderlessCount++;
                    }
                });
                if (borderlessCount > 0) {
                    visual_border_missing = true;
                }
            }

            // 2. Extract only the article body, then convert tables inside that body.
            const contentCandidate = selectContentCandidate($);
            const text = extractTextFromCandidate(contentCandidate);

            return {
                success: true,
                extracted_text: text,
                metadata: {
                    visual_border_missing,
                    content_selector: contentCandidate.selector,
                    content_score: Math.round(contentCandidate.score),
                    content_noise_terms: contentCandidate.noiseTerms
                }
            };

        } catch (error: any) {
            return { success: false, error: error?.message || 'html_parse_failed' };
        }
    }
}

export default new HtmlParseService();

