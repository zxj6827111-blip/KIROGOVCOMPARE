import express, { Request, Response, Router } from 'express';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { ensureSqliteMigrations, querySqlite, executeSqlite, sqlValue, DATA_DIR } from '../config/sqlite';
import { authMiddleware } from '../middleware/auth';

const router: Router = express.Router();

// PDF 导出文件存储目录
export const PDF_EXPORTS_DIR = path.join(DATA_DIR, 'exports', 'pdf');

// 确保导出目录存在
function ensureExportsDir(): void {
    if (!fs.existsSync(PDF_EXPORTS_DIR)) {
        fs.mkdirSync(PDF_EXPORTS_DIR, { recursive: true });
    }
}

/**
 * POST /api/pdf-jobs
 * 创建 PDF 导出任务
 */
router.post('/', (req: Request, res: Response) => {
    try {
        ensureSqliteMigrations();
        ensureExportsDir();

        const { comparison_id, title } = req.body;

        if (!comparison_id) {
            return res.status(400).json({ error: 'comparison_id is required' });
        }

        // 检查 comparison 是否存在
        const comparisonRows = querySqlite(`
      SELECT c.id, c.year_a, c.year_b, r.unit_name, reg.name as region_name
      FROM comparisons c
      JOIN reports r ON c.left_report_id = r.id
      JOIN regions reg ON r.region_id = reg.id
      WHERE c.id = ${sqlValue(comparison_id)};
    `) as Array<{ id: number; year_a: number; year_b: number; unit_name: string; region_name: string }>;

        if (comparisonRows.length === 0) {
            return res.status(404).json({ error: 'Comparison not found' });
        }

        const comparison = comparisonRows[0];

        // 生成任务标题
        const exportTitle = title || `${comparison.region_name} ${comparison.year_a}-${comparison.year_b} 年报对比`;

        // 生成文件名 (地区_年份A-年份B.pdf)
        const safeRegionName = (comparison.region_name || '未知地区').replace(/[\\/:*?"<>|]/g, '_');
        const fileName = `${safeRegionName}_${comparison.year_a}-${comparison.year_b}年报对比.pdf`;

        // 创建 PDF 导出任务
        executeSqlite(`
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
        '等待处理',
        ${sqlValue(comparison_id)},
        ${sqlValue(exportTitle)},
        ${sqlValue(fileName)}
      );
    `);

        // 获取新创建的任务 ID
        const result = querySqlite('SELECT last_insert_rowid() as id;') as Array<{ id: number }>;
        const jobId = result[0]?.id;

        return res.status(201).json({
            success: true,
            job_id: jobId,
            message: 'PDF 导出任务已创建，请前往任务中心查看进度',
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
 * 获取 PDF 导出任务列表
 */
router.get('/', authMiddleware, (req: Request, res: Response) => {
    try {
        ensureSqliteMigrations();

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
        const user = (req as any).user;
        if (user && user.dataScope && Array.isArray(user.dataScope.regions) && user.dataScope.regions.length > 0) {
            const scopeNames = user.dataScope.regions.map((n: string) => `'${n.replace(/'/g, "''")}'`).join(',');
            const scopeIdsQuery = `
            WITH RECURSIVE allowed_ids AS (
                SELECT id FROM regions WHERE name IN (${scopeNames})
                UNION ALL
                SELECT r.id FROM regions r JOIN allowed_ids p ON r.parent_id = p.id
            )
            SELECT id FROM allowed_ids
          `;
            try {
                const allowedRows = querySqlite(scopeIdsQuery);
                const allowedIds = allowedRows.map((row: any) => row.id).join(',');
                if (allowedIds.length > 0) {
                    conditions.push(`c.region_id IN (${allowedIds})`);
                } else {
                    conditions.push('1=0');
                }
            } catch (e) {
                console.error('Error calculating scope IDs in pdf-jobs:', e);
                conditions.push('1=0');
            }
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;


        // 获取总数
        const countResult = querySqlite(`
      SELECT COUNT(*) as total FROM jobs j 
      LEFT JOIN comparisons c ON j.comparison_id = c.id
      ${whereClause};
    `) as Array<{ total: number }>;
        const total = countResult[0]?.total || 0;

        // 获取任务列表
        const rows = querySqlite(`
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

        // 检查文件是否存在（可能已被清理）
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
 * 下载已生成的 PDF 文件
 */
router.get('/:id/download', (req: Request, res: Response) => {
    try {
        ensureSqliteMigrations();

        const jobId = Number(req.params.id);
        if (isNaN(jobId)) {
            return res.status(400).json({ error: 'Invalid job ID' });
        }

        // 获取任务信息
        const rows = querySqlite(`
      SELECT 
        j.id, j.status, j.file_path, j.file_name, j.comparison_id, j.export_title
      FROM jobs j
      WHERE j.id = ${sqlValue(jobId)} AND j.kind = 'pdf_export';
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

        // 检查任务状态
        if (job.status !== 'done') {
            return res.status(400).json({
                error: 'PDF not ready',
                status: job.status,
                message: job.status === 'running' ? '正在生成中，请稍后再试' : '任务尚未完成'
            });
        }

        // 检查文件是否存在
        if (!job.file_path || !fs.existsSync(job.file_path)) {
            // 文件已被清理，需要重新生成
            return res.status(410).json({
                error: 'File expired',
                message: '文件已过期被清理，请重新生成',
                comparison_id: job.comparison_id,
                needs_regeneration: true
            });
        }

        // 发送文件
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
 * 删除 PDF 导出任务及其文件
 */
router.delete('/:id', (req: Request, res: Response) => {
    try {
        ensureSqliteMigrations();

        const jobId = Number(req.params.id);
        if (isNaN(jobId)) {
            return res.status(400).json({ error: 'Invalid job ID' });
        }

        // 获取任务信息
        const rows = querySqlite(`
      SELECT file_path FROM jobs WHERE id = ${sqlValue(jobId)} AND kind = 'pdf_export';
    `) as Array<{ file_path: string | null }>;

        if (rows.length === 0) {
            return res.status(404).json({ error: 'PDF export job not found' });
        }

        // 删除文件（如果存在）
        const filePath = rows[0].file_path;
        if (filePath && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                console.warn('[PDF Jobs] Failed to delete file:', filePath);
            }
        }

        // 删除任务记录
        executeSqlite(`DELETE FROM jobs WHERE id = ${sqlValue(jobId)};`);

        return res.json({ success: true, message: 'PDF export job deleted' });

    } catch (error: any) {
        console.error('[PDF Jobs] Error deleting PDF export job:', error);
        return res.status(500).json({ error: 'Delete failed', message: error.message });
    }
});

/**
 * POST /api/pdf-jobs/:id/regenerate
 * 重新生成已过期的 PDF
 */
router.post('/:id/regenerate', (req: Request, res: Response) => {
    try {
        ensureSqliteMigrations();

        const jobId = Number(req.params.id);
        if (isNaN(jobId)) {
            return res.status(400).json({ error: 'Invalid job ID' });
        }

        // 获取原任务信息
        const rows = querySqlite(`
      SELECT comparison_id, export_title FROM jobs 
      WHERE id = ${sqlValue(jobId)} AND kind = 'pdf_export';
    `) as Array<{ comparison_id: number; export_title: string }>;

        if (rows.length === 0) {
            return res.status(404).json({ error: 'PDF export job not found' });
        }

        const { comparison_id, export_title } = rows[0];

        // 生成新文件名
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `comparison_${comparison_id}_${timestamp}.pdf`;

        // 重置任务状态
        executeSqlite(`
      UPDATE jobs SET 
        status = 'queued',
        progress = 0,
        step_code = 'QUEUED',
        step_name = '等待处理',
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
            message: '已重新加入生成队列，请稍后查看',
            file_name: fileName
        });

    } catch (error: any) {
        console.error('[PDF Jobs] Error regenerating PDF:', error);
        return res.status(500).json({ error: 'Regeneration failed', message: error.message });
    }
});

/**
 * POST /api/pdf-jobs/batch-download
 * 批量下载 PDF（打包成 ZIP）
 */
router.post('/batch-download', (req: Request, res: Response) => {
    try {
        ensureSqliteMigrations();

        const { job_ids } = req.body;

        if (!job_ids || !Array.isArray(job_ids) || job_ids.length === 0) {
            return res.status(400).json({ error: 'job_ids array is required' });
        }

        // 获取指定任务的文件信息
        const placeholders = job_ids.map(() => '?').join(',');
        const jobs = querySqlite(`
      SELECT id, file_path, file_name, export_title, status 
      FROM jobs 
      WHERE id IN (${job_ids.map(id => sqlValue(id)).join(',')}) 
        AND kind = 'pdf_export' 
        AND status = 'done'
        AND file_path IS NOT NULL;
    `) as Array<{
            id: number;
            file_path: string;
            file_name: string;
            export_title: string;
            status: string;
        }>;

        if (jobs.length === 0) {
            return res.status(404).json({ error: '没有可下载的文件' });
        }

        // 检查文件是否存在
        const existingFiles = jobs.filter(job => fs.existsSync(job.file_path));

        if (existingFiles.length === 0) {
            return res.status(404).json({ error: '所有文件已过期，请重新生成' });
        }

        // 生成 ZIP 文件名
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const zipFileName = `比对报告批量下载_${timestamp}.zip`;

        // 设置响应头
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipFileName)}`);

        // 创建 archiver 实例
        const archive = archiver('zip', { zlib: { level: 5 } });

        archive.on('error', (err) => {
            console.error('[PDF Jobs] Archive error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to create ZIP', message: err.message });
            }
        });

        // 管道输出到响应
        archive.pipe(res);

        // 添加文件到 ZIP
        for (const job of existingFiles) {
            const fileName = job.file_name || `比对报告_${job.id}.pdf`;
            archive.file(job.file_path, { name: fileName });
        }

        // 完成打包
        archive.finalize();

    } catch (error: any) {
        console.error('[PDF Jobs] Error creating batch download:', error);
        if (!res.headersSent) {
            return res.status(500).json({ error: 'Batch download failed', message: error.message });
        }
    }
});

export default router;
