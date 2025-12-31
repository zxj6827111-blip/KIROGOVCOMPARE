import * as fs from 'fs';
import * as path from 'path';
import PdfParseService from '../src/services/PdfParseService';

async function reproduce() {
    const pdfPath = String.raw`D:\软件开发\谷歌反重力开发\KIROGOVCOMPARE\data\uploads\79\2024\76d1d88bd749c384bf5b97a7289b698fbc95efeda250d14cbf10d7884472f5ee.pdf`;

    if (!fs.existsSync(pdfPath)) {
        console.error('File not found:', pdfPath);
        return;
    }

    console.log('Parsing:', pdfPath);
    try {
        const result = await PdfParseService.parsePDF(pdfPath, 'repro_test');

        if (result.success && result.document) {
            console.log('\n--- Extracted Text Preview (Check for extra spaces) ---');
            // Show a segment that usually has issues, e.g., the beginning or header
            console.log(result.document.extracted_text.slice(0, 1000));

            console.log('\n--- Tables Preview (Check for missing numbers) ---');
            result.document.sections.forEach(s => {
                if (s.tables.length > 0) {
                    console.log(`\nSection: ${s.title}`);
                    s.tables.forEach((t, i) => {
                        console.log(`  Table ${i + 1}: ${t.rows.length} rows, ${t.columns} columns`);
                        // Print rows to visually inspect
                        t.rows.forEach((r, rIdx) => {
                            const rowStr = r.cells.map(c => `[${c.content.replace(/\n/g, '')}]`).join('');
                            // Only print interesting rows (non-empty) or first few
                            if (rowStr.length > 10) {
                                console.log(`    R${rIdx}: ${rowStr}`);
                            }
                        });
                    });
                }
            });
        } else {
            console.error('Parse failed:', result.error);
        }
    } catch (err) {
        console.error('Error during reproduction:', err);
    }
}

reproduce();
