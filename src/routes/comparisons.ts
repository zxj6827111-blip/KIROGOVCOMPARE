import express, { Request, Response } from 'express';
import * as path from 'path';
import TaskService from '../services/TaskService';
import AssetService from '../services/AssetService';
import PdfExportService, { ComparisonReportData } from '../services/PdfExportService';
import { calculateDiffs, renderDiffHtml } from '../utils/diffRenderer';

const router = express.Router();

router.get('/:id/export', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const format = (req.query.format as string) || 'pdf';

    // We only support PDF now
    if (format !== 'pdf') {
      return res.status(400).json({ error: 'Unsupported format. Only "pdf" is supported.' });
    }

    const task = await TaskService.getTaskById(id);
    if (!task) {
      return res.status(404).json({ error_code: 'COMPARE_NOT_READY', error: '任务不存在' });
    }

    if (task.status !== 'succeeded') {
      return res.status(409).json({ error_code: 'COMPARE_NOT_READY', error: '任务未完成' });
    }

    const diffResult = await TaskService.getViewModelForTask(id);
    if (!diffResult) {
      return res.status(404).json({ error_code: 'COMPARE_NOT_READY', error: '无比对结果' });
    }

    const [assetA, assetB] = await Promise.all([
      AssetService.getAssetById(task.assetId_A),
      AssetService.getAssetById(task.assetId_B),
    ]);

    // Create Report Objects similar to frontend "Report" type
    // We need 'meta' and 'data'
    const reportA = {
      meta: {
        id: assetA?.assetId,
        year: assetA?.year,
        unitName: assetA?.region // assuming region is unitName for logic consistency
      },
      data: {
        sections: [] // We might need to fetch full asset content if we want full text, 
        // but diffResult usually contains the sections we needed.
        // However, TaskService.getViewModelForTask returns "sections" which are the *result* of diff?
        // Actually the backend 'diffResult' seems to be the comparison result directly.
      }
    };

    const reportB = {
      meta: {
        id: assetB?.assetId,
        year: assetB?.year,
        unitName: assetB?.region
      },
      data: { sections: [] }
    };

    // Determine Older/Newer
    const [olderReport, newerReport] = (reportA.meta.year || 0) < (reportB.meta.year || 0)
      ? [reportA, reportB]
      : [reportB, reportA];

    // The diffResult.sections from getViewModelForTask likely contains { title, oldSec, newSec, etc }?
    // Let's look at TaskService.getViewModelForTask:
    // It returns { taskId, sections: diffData.sections }
    // diffData.sections array elements usually have: { sectionTitle, paragraphs: [], tables: [] } in the raw JSON?
    // BUT, the React frontend logic `useMemo` aligns them.
    // The backend `getViewModelForTask` seems to return the raw diff JSON structure?
    // Wait, let's check `ComparisonView.tsx` again.
    // Frontend uses `older.data.sections` and `newer.data.sections` to BUILD `alignedSections`.
    // Backend `getViewModelForTask` says it returns "complete paragraphs and tables, not just diffs".
    // If so, we can use `diffResult.sections`.

    // Actually, to ensure 1:1 match with frontend logic, we should probably RE-RUN the alignment logic 
    // OR trust that `diffResult` (which comes from `diff_results` table) has what we need?
    // The previous `ComparisonView.tsx` logic computes `alignedSections` locally in browser!
    // So the backend DB stores the raw assets and maybe a "diff json" produced by Python/LLM? 
    // NO, `TaskService.getViewModelForTask` reads `diff_result` column.
    // The React view uses `older` and `newer` reports (fetched via AssetService -> getParseData?) 
    // logic: `older.data.sections` comes from `activeDocument.data.sections`.

    // CRITICAL: We need the FULL TEXT of both documents to perform the text diff rendering if we want to use `diff-match-patch`
    // OR if the `diff_result` stored in DB already has the diffs?

    // Looking at `ComparisonView.tsx`:
    // It imports `Report` type. It takes `reportA` and `reportB`.
    // It ALIGNS sections by title.
    // Then checks `oldSec.type` vs `newSec.type`.
    // If `text`, it calls `DiffText` component which does `diff_match_patch` on client side.

    // SO: We need to load the parsed data for both assets.
    // `AssetService.getAssetContent` only returns metadata.
    // `AssetService.getAssetParseData` was commented out! 
    // But `TaskService.getViewModelForTask` exists.

    // Let's look at what `ComparisonView.tsx` does in `getViewModelForTask` in backend?
    // No, `ComparisonView.tsx` is frontend.
    // The backend `TaskService` returns `diffData.sections`. 
    // If `diffData` is the result of the Python/LLM comparison, it might ALREADY include the diffs?
    // `ComparisonView.tsx` uses `api.createComparison` to triggers a job.
    // But sending `reportA` and `reportB` to `ComparisonView` props happens in `ComparisonDetailView.js` (frontend container).

    // If I want to render independent PDF, I need to fetch the PARSED data of both reports.
    // `AssetService.getAssetParseData` (TaskService.ts lines 286-302) is where I should look. 
    // It returns NULL currently because "ParsesDataStorageService" is commented out.
    // BUT `TaskService.getViewModelForTask` reads `diff_results` table.

    // Let's assume for now that `diffResult.sections` (from DB) is what we have. 
    // But `ComparisonView.tsx` logic (line 358) manually aligns sections from `older.data.sections` and `newer.data.sections`.
    // It DOES NOT use the `diffResult` from API for the main view content! 
    // It ONLY uses `diffResult` from API (lines 471+) for the "AI Check" status and maybe the `diffTable`?
    // WAIT. Line 358: `const { alignedSections } = useMemo(() => ... older.data.sections ... newer.data.sections`.
    // YES. The frontend re-implements the alignment logic.
    // So to replicate this on backend, I MUST fetch the `sections` of both assets.

    // How to get asset sections on backend?
    // `ReportAsset` model has `structuredDataPath`. We probably need to read that JSON file.

    // I will add a helper to read the JSON file from `structuredDataPath`.
    const fetchAssetData = async (asset: any) => {
      if (!asset || !asset.structuredDataPath) return { sections: [] };
      try {
        // Check if path is absolute or relative?
        // Usually in this project it seems paths are relative or we need to check.
        // If it's stored in `data/`, we might need `process.cwd()`.
        let jsonPath = asset.structuredDataPath;
        if (!path.isAbsolute(jsonPath)) {
          jsonPath = path.join(process.cwd(), jsonPath);
        }
        if (require('fs').existsSync(jsonPath)) {
          const content = require('fs').readFileSync(jsonPath, 'utf-8');
          return JSON.parse(content);
        }
      } catch (e) {
        console.error('Error reading asset data', e);
      }
      return { sections: [] };
    };

    const dataA = await fetchAssetData(assetA);
    const dataB = await fetchAssetData(assetB);

    reportA.data = dataA;
    reportB.data = dataB;

    // Now Replicate the Alignment Logic (from ComparisonView.tsx)
    const sections: any[] = [];
    olderReport.data.sections.forEach((s: any) => sections.push({ title: s.title, oldSec: s }));
    newerReport.data.sections.forEach((s: any) => {
      const existing = sections.find(a => a.title === s.title);
      if (existing) existing.newSec = s;
      else sections.push({ title: s.title, newSec: s });
    });

    // Sort Logic (numerals)
    const numerals = ['一', '二', '三', '四', '五', '六', '七', '八'];
    sections.sort((a, b) => {
      const isTitleA = a.title === '标题' || a.title.includes('年度报告');
      const isTitleB = b.title === '标题' || b.title.includes('年度报告');
      if (isTitleA && !isTitleB) return -1;
      if (!isTitleA && isTitleB) return 1;
      const idxA = numerals.findIndex(n => a.title.includes(n));
      const idxB = numerals.findIndex(n => b.title.includes(n));
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });

    // Enhance sections with Diff HTML
    sections.forEach(sec => {
      if (sec.oldSec?.type === 'text' && sec.newSec?.type === 'text') {
        const diffs = calculateDiffs(sec.oldSec.content || '', sec.newSec.content || '');
        sec.diffHtml = renderDiffHtml(diffs, false); // false = don't highlight identical (default grey)
      }

      // Populate Summary Stats logic if needed? 
      // The frontend calculates summary stats on the fly too!
      // But for "Summary Section" in PDF (existing `comparison_report.ejs` uses `summary` object),
      // we can probably reuse the `task.summary` from DB if available, 
      // OR recalculate it. Reusing `task.summary` is safer as it comes from the AI/Python backend.
    });

    // Prepare data for EJS
    const reportData: ComparisonReportData = {
      older: olderReport,
      newer: newerReport,
      summary: task.summary || {
        textRepetition: 0,
        tableRepetition: 0,
        overallRepetition: 0,
        items: []
      },
      sections: sections
    };

    const filePath = await PdfExportService.generateComparisonPdf({
      comparisonId: id,
      data: reportData
    });

    res.download(filePath, `comparison-${id}.pdf`);

  } catch (error) {
    console.error('导出比对结果失败:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
