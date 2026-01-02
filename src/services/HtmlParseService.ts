import fs from 'fs/promises';
import * as cheerio from 'cheerio';

export interface HtmlParseResult {
    success: boolean;
    extracted_text?: string;
    metadata?: {
        visual_border_missing?: boolean;
        missing_table_3?: boolean;
    };
    error?: string;
}

export class HtmlParseService {
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

            const decoder = new TextDecoder(encoding);
            const content = decoder.decode(fileBuffer);
            const $ = cheerio.load(content);

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

            // 2. Extract pure text (preserving table structure)
            // Replace tables with a structured string representation for LLM
            $('table').each((_, table) => {
                let tableText = '\n[TABLE_START]\n';
                $(table).find('tr').each((_, tr) => {
                    let row: string[] = [];
                    $(tr).find('td,th').each((_, td) => {
                        row.push($(td).text().trim());
                    });
                    tableText += row.join('\t') + '\n';
                });
                tableText += '[TABLE_END]\n';
                $(table).replaceWith(tableText);
            });

            const text = $.root().text();

            return {
                success: true,
                extracted_text: text,
                metadata: {
                    visual_border_missing
                }
            };

        } catch (error: any) {
            return { success: false, error: error?.message || 'html_parse_failed' };
        }
    }
}

export default new HtmlParseService();
