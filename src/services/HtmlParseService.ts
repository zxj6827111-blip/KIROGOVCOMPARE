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
            const content = await fs.readFile(filePath, 'utf-8');
            const $ = cheerio.load(content);

            // 1. Extract pure text (preserving some structure)
            // For simplicity, we just extract text. Ideally we might want structured text.
            // But Gemini handles raw HTML/Text well usually. Let's just give it the full text 
            // but we perform the visual checks on the DOM.
            const text = $.root().text();

            // 2. Visual Audit: Border Detection
            // Check for tables that explicitly turn off borders or lack border styling
            let visual_border_missing = false;
            const tables = $('table');

            if (tables.length > 0) {
                // Iterate checking for border="0" or style="border:none"
                // This is a heuristic. If ANY table shows border=0, we flag it cautionarily, 
                // or we check if ALL tables have it. Let's be strict: if we find significant content without borders.
                let borderlessCount = 0;
                tables.each((_, el) => {
                    const table = $(el);
                    const borderAttr = table.attr('border');
                    const styleAttr = table.attr('style') || '';
                    const classAttr = table.attr('class') || '';

                    const hasNoBorderAttr = borderAttr === '0';
                    const hasNoBorderStyle = styleAttr.includes('border:none') || styleAttr.includes('border: none') || styleAttr.includes('border:0');
                    // Simple heuristic: If it looks like a government data table (lots of cells) but has no border
                    if (table.find('tr').length > 3 && (hasNoBorderAttr || hasNoBorderStyle)) {
                        borderlessCount++;
                    }
                });

                if (borderlessCount > 0) {
                    visual_border_missing = true;
                }
            }

            // 3. Structure Audit: Missing Table 3
            // Heuristic: Find section title "收到和处理...申请" and check if a table follows it.
            let missing_table_3 = false;
            // This is harder in raw HTML without running layout. 
            // We'll leave structural audit to the Semantic Layer (ConsistencyCheck) based on the JSON output.
            // Because even if we find a table tag, we don't know if it belongs to Section 3 without complex logic.

            return {
                success: true,
                extracted_text: text, // Or structure it better if needed
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
