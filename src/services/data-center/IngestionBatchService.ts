
import pool from '../../config/database-llm';
import { v4 as uuidv4 } from 'uuid';

export interface BatchStats {
    id: number;
    batch_uuid: string;
    report_count: number;
    success_count: number;
    fail_count: number;
    status: string;
}

export class IngestionBatchService {
    /**
     * Start a new ingestion batch.
     */
    async startBatch(createdBy: number | null, source: string = 'upload', note?: string): Promise<string> {
        const batchUuid = uuidv4();
        const result = await pool.query(
            `INSERT INTO ingestion_batches (batch_uuid, created_by, source, note, status)
       VALUES ($1, $2, $3, $4, 'processing')
       RETURNING batch_uuid`,
            [batchUuid, createdBy, source, note]
        );
        return result.rows[0].batch_uuid;
    }

    /**
     * Update batch statistics after a job completes.
     */
    async updateBatchStats(batchId: number): Promise<void> {
        // Recalculate stats from report_versions and jobs
        const result = await pool.query(
            `WITH stats AS (
         SELECT 
           COUNT(DISTINCT report_id) as total,
           COUNT(DISTINCT CASE WHEN status = 'succeeded' THEN report_id END) as success,
           COUNT(DISTINCT CASE WHEN status = 'failed' THEN report_id END) as fail
         FROM jobs
         WHERE ingestion_batch_id = $1
       )
       UPDATE ingestion_batches
       SET 
         report_count = stats.total,
         success_count = stats.success,
         fail_count = stats.fail,
         status = CASE 
           WHEN stats.total = (stats.success + stats.fail) THEN 'completed'
           ELSE 'processing'
         END,
         completed_at = CASE 
           WHEN stats.total = (stats.success + stats.fail) THEN NOW()
           ELSE NULL
         END
       FROM stats
       WHERE id = $1`,
            [batchId]
        );
    }

    /**
     * Get batch details by ID or UUID
     */
    async getBatch(idOrUuid: string | number): Promise<BatchStats | null> {
        const isUuid = typeof idOrUuid === 'string' && idOrUuid.length > 30;
        const query = isUuid
            ? 'SELECT * FROM ingestion_batches WHERE batch_uuid = $1'
            : 'SELECT * FROM ingestion_batches WHERE id = $1';

        const result = await pool.query(query, [idOrUuid]);
        return result.rows[0] || null;
    }
}

export const ingestionBatchService = new IngestionBatchService();
