import express, { Response, Router } from 'express';
import pool from '../config/database-llm';
import { authMiddleware, AuthRequest, generateExpiringToken } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';
import {
    findFrontendUrl as discoverFrontendUrl,
    renderPdfBuffer,
} from '../services/report-export/BrowserRenderer';
import {
    COMPARISON_LANDSCAPE_PDF_OPTIONS,
    createComparisonPrintPageAdapter,
} from '../services/report-export/PrintPageAdapter';

const router: Router = express.Router();
const SERVICE_TOKEN_TTL_MS = 5 * 60 * 1000;
const PDF_EXPORT_HYDRATE_WAIT_MS = Number(process.env.PDF_EXPORT_HYDRATE_WAIT_MS || 1500);
const PDF_EXPORT_PRINT_READY_TIMEOUT_MS = Number(process.env.PDF_EXPORT_PRINT_READY_TIMEOUT_MS || 45000);

async function findFrontendUrl(): Promise<string | null> {
    return discoverFrontendUrl({
        logPrefix: 'PDF Export',
        ports: [3000, 3001, 3002, 3003],
        hosts: ['localhost'],
        method: 'HEAD',
    });
}

/**
 * GET /api/comparisons/:id/pdf
 * Compatibility synchronous path. Prefer POST /api/pdf-jobs for user-facing comparison PDF exports.
 */
router.get('/:id/pdf', authMiddleware, async (req: AuthRequest, res: Response) => {
    const comparisonId = Number(req.params.id);

    try {
        if (!Number.isInteger(comparisonId) || comparisonId < 1) {
            return res.status(400).json({ error: 'invalid_comparison_id' });
        }

        if (!req.user) {
            return res.status(401).json({ error: 'unauthorized' });
        }

        const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
        if (allowedRegionIds && allowedRegionIds.length === 0) {
            return res.status(403).json({ error: 'forbidden' });
        }

        const comparisonRes = await pool.query(`
            SELECT c.id, lr.region_id as left_region_id, rr.region_id as right_region_id
            FROM comparisons c
            JOIN reports lr ON c.left_report_id = lr.id
            JOIN reports rr ON c.right_report_id = rr.id
            WHERE c.id = $1
            LIMIT 1;
        `, [comparisonId]);

        if (comparisonRes.rows.length === 0) {
            return res.status(404).json({ error: 'comparison_not_found' });
        }

        if (allowedRegionIds) {
            const { left_region_id, right_region_id } = comparisonRes.rows[0];
            if (!allowedRegionIds.includes(left_region_id) || !allowedRegionIds.includes(right_region_id)) {
                return res.status(403).json({ error: 'forbidden' });
            }
        }

        console.log(`[PDF Export] Compatibility synchronous export requested for comparison ${comparisonId}. Prefer /api/pdf-jobs for user-facing comparison PDFs.`);

        const frontendUrl = await findFrontendUrl();
        if (!frontendUrl) {
            throw new Error('无法找到可用的前端服务。请确保前端开发服务器正在运行。');
        }

        const highlightIdentical = req.query.highlightIdentical === 'true';
        const highlightDiff = req.query.highlightDiff === 'true';
        const serviceToken = generateExpiringToken(req.user.id, req.user.username, SERVICE_TOKEN_TTL_MS);
        const logParams = new URLSearchParams({
            highlightIdentical: highlightIdentical.toString(),
            highlightDiff: highlightDiff.toString(),
        });
        const logUrl = `${frontendUrl}/print/comparison/${comparisonId}?${logParams}`;
        console.log(`[PDF Export] Accessing print URL: ${logUrl} (service token redacted)`);

        const adapter = createComparisonPrintPageAdapter({
            comparisonId,
            highlightIdentical,
            highlightDiff,
            viewportDeviceScaleFactor: 2,
            hydrateWaitMs: PDF_EXPORT_HYDRATE_WAIT_MS,
            readyTimeoutMs: PDF_EXPORT_PRINT_READY_TIMEOUT_MS,
            loadingSelectorFatal: true,
            pdfOptions: {
                ...COMPARISON_LANDSCAPE_PDF_OPTIONS,
                preferCSSPageSize: true,
            },
        });

        console.log('[PDF Export] Generating PDF...');
        const { buffer: nodeBuffer, title: pageTitle } = await renderPdfBuffer({
            adapter,
            frontendUrl,
            serviceToken,
            logPrefix: 'PDF Export',
        });

        console.log(`[PDF Export] PDF generated successfully, size: ${nodeBuffer.length} bytes`);

        const origin = req.headers.origin;
        if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        } else {
            res.setHeader('Access-Control-Allow-Origin', '*');
        }
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Type');
        res.setHeader('Access-Control-Allow-Credentials', 'true');

        const filename = encodeURIComponent(pageTitle || `比对报告_${comparisonId}`) + '.pdf';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
        res.setHeader('Content-Length', nodeBuffer.length);
        res.end(nodeBuffer);
    } catch (error: any) {
        console.error('[PDF Export] Error generating PDF:', error);
        res.status(500).json({
            error: 'PDF 生成失败',
            message: error.message || 'Unknown error',
        });
    }
});

export default router;
