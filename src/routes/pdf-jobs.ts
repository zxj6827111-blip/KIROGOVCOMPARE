import express, { Response, Router } from 'express';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { dbExecute, dbQuery, ensureDbMigrations } from '../config/db-llm';
import { sqlValue, DATA_DIR } from '../config/sqlite';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIds } from '../utils/dataScope';

const router: Router = express.Router();

// PDF 瀵煎嚭鏂囦欢瀛樺偍鐩綍
export const PDF_EXPORTS_DIR = path.join(DATA_DIR, 'exports', 'pdf');

// 纭繚瀵煎嚭鐩綍瀛樺湪
function ensureExportsDir(): void {
    if (!fs.existsSync(PDF_EXPORTS_DIR)) {
        fs.mkdirSync(PDF_EXPORTS_DIR, { recursive: true });
    }
}

/**
 * POST /api/pdf-jobs
 * 鍒涘缓 PDF 瀵煎嚭浠诲姟
 */
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        ensureDbMigrations();
        ensureExportsDir();

        const { comparison_id, title } = req.body;
        const allowedRegionIds = getAllowedRegionIds(req.user);

        if (allowedRegionIds && allowedRegionIds.length === 0) {
            return res.status(403).json({ error: 'forbidden' });
        }

        if (!comparison_id) {
            return res.status(400).json({ error: 'comparison_id is required' });
        }

        // 妫€鏌?comparison 鏄惁瀛樺湪
        const scopeClause = allowedRegionIds ? `AND reg.id IN (${allowedRegionIds.join(',')})` : '';
        const comparisonRows = await dbQuery(`
      SELECT c.id, c.year_a, c.year_b, r.unit_name, reg.name as region_name
      FROM comparisons c
      JOIN reports r ON c.left_report_id = r.id
      JOIN regions reg ON r.region_id = reg.id
      WHERE c.id = ${sqlValue(comparison_id)}
      ${scopeClause};
    `) as Array<{ id: number; year_a: number; year_b: number; unit_name: string; region_name: string }>;

        if (comparisonRows.length === 0) {
            return res.status(404).json({ error: 'Comparison not found' });
        }

        const comparison = comparisonRows[0];

        // 鐢熸垚浠诲姟鏍囬
        const exportTitle = title || `${comparison.region_name} ${comparison.year_a}-${comparison.year_b} 骞存姤瀵规瘮`;

        // 鐢熸垚鏂囦欢鍚?(鍦板尯_骞翠唤A-骞翠唤B.pdf)
        const safeRegionName = (comparison.region_name || '鏈煡鍦板尯').replace(/[\\/:*?"<>|]/g, '_');
        const fileName = `${safeRegionName}_${comparison.year_a}-${comparison.year_b}骞存姤瀵规瘮.pdf`;

        // 鍒涘缓 PDF 瀵煎嚭浠诲姟
        const result = await dbQuery(`
      INSERT INTO jobs (
        report_id, 
        kind, 
        status, 
        progress, 
        step_code, 
        step_name,
        comparison_id,
        export_title,
        file_name
      ) VALUES (
        0,
        'pdf_export',
        'queued',
        0,
        'QUEUED',
        '绛夊緟澶勭悊',
        ${sqlValue(comparison_id)},
        ${sqlValue(exportTitle)},
        ${sqlValue(fileName)}
      )
      RETURNING id;
    `);

        // 鑾峰彇鏂板垱寤虹殑浠诲姟 ID
        const jobId = result[0]?.id;

        return res.status(201).json({
            success: true,
            job_id: jobId,
            message: 'PDF 瀵煎嚭浠诲姟宸插垱寤猴紝璇峰墠寰€浠诲姟涓績鏌ョ湅杩涘害',
            export_title: exportTitle,
            file_name: fileName
        });

    } catch (error: any) {
        console.error('[PDF Jobs] Error creating PDF export job:', error);
        return res.status(500).json({
            error: 'Failed to create PDF export job',
            message: error.message
        });
    }
});

/**
 * GET /api/pdf-jobs
 * 鑾峰彇 PDF 瀵煎嚭浠诲姟鍒楄〃
 */
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        ensureDbMigrations();

        const { status, page, limit } = req.query;

        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
        const offset = (pageNum - 1) * limitNum;

        const conditions: string[] = ["j.kind = 'pdf_export'"];
        if (status) {
            const normalizedStatus = status === 'processing' ? 'running' : status;
            conditions.push(`j.status = ${sqlValue(String(normalizedStatus))}`);
        }

        // DATA SCOPE FILTER
        const allowedRegionIds = getAllowedRegionIds(req.user);
        if (allowedRegionIds) {
            if (allowedRegionIds.length > 0) {
                conditions.push(`c.region_id IN (${allowedRegionIds.join(',')})`);
            } else {
                conditions.push('1=0');
            }
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;


        // 鑾峰彇鎬绘暟
        const countResult = await dbQuery(`
      SELECT COUNT(*) as total FROM jobs j 
      LEFT JOIN comparisons c ON j.comparison_id = c.id
      ${whereClause};
    `) as Array<{ total: number }>;
        const total = countResult[0]?.total || 0;

        // 鑾峰彇浠诲姟鍒楄〃
        const rows = await dbQuery(`
      SELECT 
        j.id as job_id,
        j.comparison_id,
        j.status,
        j.progress,
        j.step_name,
        j.export_title,
        j.file_name,
        j.file_path,
        j.file_size,
        j.created_at,
        j.started_at,
        j.finished_at,
        j.error_message
      FROM jobs j
      LEFT JOIN comparisons c ON j.comparison_id = c.id
      ${whereClause}
      ORDER BY j.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset};
    `) as Array<{
            job_id: number;
            comparison_id: number;
            status: string;
            progress: number;
            step_name: string;
            export_title: string;
            file_name: string;
            file_path: string | null;
            file_size: number | null;
            created_at: string;
            started_at: string | null;
            finished_at: string | null;
            error_message: string | null;
        }>;

        // 妫€鏌ユ枃浠舵槸鍚﹀瓨鍦紙鍙兘宸茶娓呯悊锛?
        const jobs = rows.map(row => {
            const displayStatus = row.status === 'running' ? 'processing' : row.status;
            let fileExists = false;

            if (row.file_path && row.status === 'done') {
                fileExists = fs.existsSync(row.file_path);
            }

            return {
                ...row,
                status: displayStatus,
                file_exists: fileExists
            };
        });

        return res.json({
            jobs,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            }
        });

    } catch (error: any) {
        console.error('[PDF Jobs] Error listing PDF export jobs:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/pdf-jobs/:id/download
 * 涓嬭浇宸茬敓鎴愮殑 PDF 鏂囦欢
 */
router.get('/:id/download', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        ensureDbMigrations();

        const jobId = Number(req.params.id);
        if (isNaN(jobId)) {
            return res.status(400).json({ error: 'Invalid job ID' });
        }

        const allowedRegionIds = getAllowedRegionIds(req.user);
        if (allowedRegionIds && allowedRegionIds.length === 0) {
            return res.status(403).json({ error: 'forbidden' });
        }

        const scopeClause = allowedRegionIds ? `AND r.region_id IN (${allowedRegionIds.join(',')})` : '';

        // 鑾峰彇浠诲姟淇℃伅
        const rows = await dbQuery(`
      SELECT 
        j.id, j.status, j.file_path, j.file_name, j.comparison_id, j.export_title
      FROM jobs j
      LEFT JOIN comparisons c ON j.comparison_id = c.id
      LEFT JOIN reports r ON c.left_report_id = r.id
      WHERE j.id = ${sqlValue(jobId)} AND j.kind = 'pdf_export'
      ${scopeClause};
    `) as Array<{
            id: number;
            status: string;
            file_path: string | null;
            file_name: string;
            comparison_id: number;
            export_title: string;
        }>;

        if (rows.length === 0) {
            return res.status(404).json({ error: 'PDF export job not found' });
        }

        const job = rows[0];

        // 妫€鏌ヤ换鍔＄姸鎬?
        if (job.status !== 'done') {
            return res.status(400).json({
                error: 'PDF not ready',
                status: job.status,
                message: job.status === 'running' ? '姝ｅ湪鐢熸垚涓紝璇风◢鍚庡啀璇? : '浠诲姟灏氭湭瀹屾垚'
            });
        }

        // 妫€鏌ユ枃浠舵槸鍚﹀瓨鍦?
        if (!job.file_path || !fs.existsSync(job.file_path)) {
            // 鏂囦欢宸茶娓呯悊锛岄渶瑕侀噸鏂扮敓鎴?
            return res.status(410).json({
                error: 'File expired',
                message: '鏂囦欢宸茶繃鏈熻娓呯悊锛岃閲嶆柊鐢熸垚',
                comparison_id: job.comparison_id,
                needs_regeneration: true
            });
        }

        // 鍙戦€佹枃浠?
        const fileName = job.file_name || `comparison_${job.comparison_id}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);

        const fileStream = fs.createReadStream(job.file_path);
        fileStream.pipe(res);

    } catch (error: any) {
        console.error('[PDF Jobs] Error downloading PDF:', error);
        return res.status(500).json({ error: 'Download failed', message: error.message });
    }
});

/**
 * DELETE /api/pdf-jobs/:id
 * 鍒犻櫎 PDF 瀵煎嚭浠诲姟鍙婂叾鏂囦欢
 */
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        ensureDbMigrations();

        const jobId = Number(req.params.id);
        if (isNaN(jobId)) {
            return res.status(400).json({ error: 'Invalid job ID' });
        }

        const allowedRegionIds = getAllowedRegionIds(req.user);
        if (allowedRegionIds && allowedRegionIds.length === 0) {
            return res.status(403).json({ error: 'forbidden' });
        }

        const scopeClause = allowedRegionIds ? `AND r.region_id IN (${allowedRegionIds.join(',')})` : '';

        // 鑾峰彇浠诲姟淇℃伅
        const rows = await dbQuery(`
      SELECT j.file_path
      FROM jobs j
      LEFT JOIN comparisons c ON j.comparison_id = c.id
      LEFT JOIN reports r ON c.left_report_id = r.id
      WHERE j.id = ${sqlValue(jobId)} AND j.kind = 'pdf_export'
      ${scopeClause};
    `) as Array<{ file_path: string | null }>;

        if (rows.length === 0) {
            return res.status(404).json({ error: 'PDF export job not found' });
        }

        // 鍒犻櫎鏂囦欢锛堝鏋滃瓨鍦級
        const filePath = rows[0].file_path;
        if (filePath && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                console.warn('[PDF Jobs] Failed to delete file:', filePath);
            }
        }

        // 鍒犻櫎浠诲姟璁板綍
        await dbExecute(`DELETE FROM jobs WHERE id = ${sqlValue(jobId)};`);

        return res.json({ success: true, message: 'PDF export job deleted' });

    } catch (error: any) {
        console.error('[PDF Jobs] Error deleting PDF export job:', error);
        return res.status(500).json({ error: 'Delete failed', message: error.message });
    }
});

/**
 * POST /api/pdf-jobs/:id/regenerate
 * 閲嶆柊鐢熸垚宸茶繃鏈熺殑 PDF
 */
router.post('/:id/regenerate', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        ensureDbMigrations();

        const jobId = Number(req.params.id);
        if (isNaN(jobId)) {
            return res.status(400).json({ error: 'Invalid job ID' });
        }

        const allowedRegionIds = getAllowedRegionIds(req.user);
        if (allowedRegionIds && allowedRegionIds.length === 0) {
            return res.status(403).json({ error: 'forbidden' });
        }

        const scopeClause = allowedRegionIds ? `AND r.region_id IN (${allowedRegionIds.join(',')})` : '';

        // 鑾峰彇鍘熶换鍔′俊鎭?        const rows = await dbQuery(`
      SELECT j.comparison_id, j.export_title
      FROM jobs j
      LEFT JOIN comparisons c ON j.comparison_id = c.id
      LEFT JOIN reports r ON c.left_report_id = r.id
      WHERE j.id = ${sqlValue(jobId)} AND j.kind = 'pdf_export'
      ${scopeClause};
    `) as Array<{ comparison_id: number; export_title: string }>;

        if (rows.length === 0) {
            return res.status(404).json({ error: 'PDF export job not found' });
        }

        const { comparison_id, export_title } = rows[0];

        // 鐢熸垚鏂版枃浠跺悕
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `comparison_${comparison_id}_${timestamp}.pdf`;

        // 閲嶇疆浠诲姟鐘舵€?
        await dbExecute(`
      UPDATE jobs SET 
        status = 'queued',
        progress = 0,
        step_code = 'QUEUED',
        step_name = '绛夊緟澶勭悊',
        file_path = NULL,
        file_size = NULL,
        file_name = ${sqlValue(fileName)},
        error_message = NULL,
        started_at = NULL,
        finished_at = NULL
      WHERE id = ${sqlValue(jobId)};
    `);

        return res.json({
            success: true,
            job_id: jobId,
            message: '宸查噸鏂板姞鍏ョ敓鎴愰槦鍒楋紝璇风◢鍚庢煡鐪?,
            file_name: fileName
        });

    } catch (error: any) {
        console.error('[PDF Jobs] Error regenerating PDF:', error);
        return res.status(500).json({ error: 'Regeneration failed', message: error.message });
    }
});

/**
 * POST /api/pdf-jobs/batch-download
 * 鎵归噺涓嬭浇 PDF锛堟墦鍖呮垚 ZIP锛?
 */
router.post('/batch-download', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        ensureDbMigrations();

        const { job_ids } = req.body;

        if (!job_ids || !Array.isArray(job_ids) || job_ids.length === 0) {
            return res.status(400).json({ error: 'job_ids array is required' });
        }

        const allowedRegionIds = getAllowedRegionIds(req.user);
        if (allowedRegionIds && allowedRegionIds.length === 0) {
            return res.status(403).json({ error: 'forbidden' });
        }

        const scopeClause = allowedRegionIds ? `AND r.region_id IN (${allowedRegionIds.join(',')})` : '';

        // 鑾峰彇鎸囧畾浠诲姟鐨勬枃浠朵俊鎭?        const placeholders = job_ids.map(() => '?').join(',');
        const jobs = await dbQuery(`
      SELECT j.id, j.file_path, j.file_name, j.export_title, j.status 
      FROM jobs j
      LEFT JOIN comparisons c ON j.comparison_id = c.id
      LEFT JOIN reports r ON c.left_report_id = r.id
      WHERE id IN (${job_ids.map(id => sqlValue(id)).join(',')}) 
        AND kind = 'pdf_export' 
        AND status = 'done'
        AND file_path IS NOT NULL
        ${scopeClause};
    `) as Array<{
            id: number;
            file_path: string;
            file_name: string;
            export_title: string;
            status: string;
        }>;

        if (jobs.length === 0) {
            return res.status(404).json({ error: '娌℃湁鍙笅杞界殑鏂囦欢' });
        }

        // 妫€鏌ユ枃浠舵槸鍚﹀瓨鍦?
        const existingFiles = jobs.filter(job => fs.existsSync(job.file_path));

        if (existingFiles.length === 0) {
            return res.status(404).json({ error: '鎵€鏈夋枃浠跺凡杩囨湡锛岃閲嶆柊鐢熸垚' });
        }

        // 鐢熸垚 ZIP 鏂囦欢鍚?
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const zipFileName = `姣斿鎶ュ憡鎵归噺涓嬭浇_${timestamp}.zip`;

        // 璁剧疆鍝嶅簲澶?
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipFileName)}`);

        // 鍒涘缓 archiver 瀹炰緥
        const archive = archiver('zip', { zlib: { level: 5 } });

        archive.on('error', (err) => {
            console.error('[PDF Jobs] Archive error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to create ZIP', message: err.message });
            }
        });

        // 绠￠亾杈撳嚭鍒板搷搴?
        archive.pipe(res);

        // 娣诲姞鏂囦欢鍒?ZIP
        for (const job of existingFiles) {
            const fileName = job.file_name || `姣斿鎶ュ憡_${job.id}.pdf`;
            archive.file(job.file_path, { name: fileName });
        }

        // 瀹屾垚鎵撳寘
        archive.finalize();

    } catch (error: any) {
        console.error('[PDF Jobs] Error creating batch download:', error);
        if (!res.headersSent) {
            return res.status(500).json({ error: 'Batch download failed', message: error.message });
        }
    }
});

export default router;

