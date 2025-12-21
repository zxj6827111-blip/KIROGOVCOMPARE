import PdfExportService from '../src/services/PdfExportService';
import path from 'path';

const mockData = {
    older: {
        meta: { unitName: "Test Region", year: 2022 }
    },
    newer: {
        meta: { unitName: "Test Region", year: 2023 }
    },
    summary: {
        textRepetition: 80,
        tableRepetition: 100,
        overallRepetition: 90,
        items: ["Item 1: Significant change in text.", "Item 2: Table data matches."]
    },
    sections: [
        {
            title: "Test Section 1",
            oldSec: { type: "text", content: "This is the old text content." },
            newSec: { type: "text", content: "This is the NEW text content with changes." },
            diffHtml: 'This is the <span class="bg-red-200 text-red-900 border-b-2 border-red-400 border-dotted" title="差异内容">NEW</span> text content with changes.'
        },
        {
            title: "Test Table 2",
            oldSec: {
                type: "table_2",
                activeDisclosureData: {
                    regulations: { made: 10, repealed: 2, valid: 100 },
                    normativeDocuments: { made: 5, repealed: 1, valid: 50 },
                    licensing: { processed: 200 },
                    punishment: { processed: 50 },
                    coercion: { processed: 10 },
                    fees: { amount: 0 }
                }
            },
            newSec: {
                type: "table_2",
                activeDisclosureData: {
                    regulations: { made: 12, repealed: 2, valid: 110 },
                    normativeDocuments: { made: 5, repealed: 1, valid: 55 },
                    licensing: { processed: 210 },
                    punishment: { processed: 40 },
                    coercion: { processed: 10 },
                    fees: { amount: 0 }
                }
            }
        }
    ]
};

async function run() {
    try {
        console.log("Starting PDF generation test...");
        const filePath = await PdfExportService.generateComparisonPdf({
            comparisonId: "test-123",
            data: mockData
        });
        console.log("PDF generated successfully at:", filePath);
    } catch (e) {
        console.error("PDF generation failed:", e);
    }
}

run();
