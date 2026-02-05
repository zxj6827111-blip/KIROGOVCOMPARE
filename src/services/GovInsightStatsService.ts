import pool from '../config/database-llm';

type RefreshReason = 'single_upload' | 'batch_complete' | 'manual';

export interface RefreshStatsOptions {
  reason: RefreshReason;
  batchId?: number;
  reportId?: number;
  versionId?: number;
}

const GOV_INSIGHT_STATS_LOCK_KEY = 917361; // Arbitrary constant for advisory lock

export class GovInsightStatsService {
  async refreshAnnualStats(options: RefreshStatsOptions): Promise<boolean> {
    const meta = [
      `reason=${options.reason}`,
      options.batchId ? `batchId=${options.batchId}` : null,
      options.reportId ? `reportId=${options.reportId}` : null,
      options.versionId ? `versionId=${options.versionId}` : null,
    ]
      .filter(Boolean)
      .join(' ');

    const startedAt = Date.now();

    try {
      const viewRes = await pool.query(
        `SELECT relkind FROM pg_class WHERE relname = 'gov_open_annual_stats' LIMIT 1`
      );
      const relkind = viewRes.rows?.[0]?.relkind;
      if (relkind !== 'm') {
        console.warn(`[GovInsightStats] Skip refresh: gov_open_annual_stats is not a materialized view (relkind=${relkind ?? 'missing'})`);
        return false;
      }

      // Serialize refresh across processes to avoid concurrent refreshes.
      await pool.query('SELECT pg_advisory_lock($1)', [GOV_INSIGHT_STATS_LOCK_KEY]);

      await pool.query('REFRESH MATERIALIZED VIEW gov_open_annual_stats');

      const elapsed = Date.now() - startedAt;
      console.log(`[GovInsightStats] Refreshed materialized view (${meta}) in ${elapsed}ms`);
      return true;
    } catch (error: any) {
      console.error('[GovInsightStats] Refresh failed:', error?.message || error);
      return false;
    } finally {
      try {
        await pool.query('SELECT pg_advisory_unlock($1)', [GOV_INSIGHT_STATS_LOCK_KEY]);
      } catch (unlockError: any) {
        console.error('[GovInsightStats] Failed to release refresh lock:', unlockError?.message || unlockError);
      }
    }
  }
}

export const govInsightStatsService = new GovInsightStatsService();
