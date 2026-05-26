import pool from '../config/database-llm';
import { govInsightStatsV2Service } from './GovInsightStatsV2Service';
import type { PoolClient } from 'pg';

type RefreshReason = 'single_upload' | 'batch_complete' | 'manual';

export interface RefreshStatsOptions {
  reason: RefreshReason;
  batchId?: number;
  reportId?: number;
  versionId?: number;
}

const GOV_INSIGHT_STATS_LOCK_KEY = 917361; // Arbitrary constant for advisory lock

interface StatsTarget {
  regionId?: number;
  year?: number;
}

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
    let lockClient: PoolClient | null = null;
    let locked = false;

    try {
      lockClient = await pool.connect();

      // Serialize refresh across processes to avoid concurrent refreshes.
      await lockClient.query('SELECT pg_advisory_lock($1)', [GOV_INSIGHT_STATS_LOCK_KEY]);
      locked = true;

      const v2Refreshed = await this.refreshStatsV2(options);

      const legacyRefreshed = await this.refreshLegacyMaterializedView();
      if (!legacyRefreshed) {
        console.warn(`[GovInsightStats] Legacy gov_open_annual_stats refresh skipped or failed (${meta})`);
      }

      const elapsed = Date.now() - startedAt;
      console.log(`[GovInsightStats] Refreshed annual stats (${meta}) v2=${v2Refreshed} legacy=${legacyRefreshed} in ${elapsed}ms`);
      return v2Refreshed;
    } catch (error: any) {
      console.error('[GovInsightStats] Refresh failed:', error?.message || error);
      return false;
    } finally {
      if (locked) {
        try {
          await lockClient?.query('SELECT pg_advisory_unlock($1)', [GOV_INSIGHT_STATS_LOCK_KEY]);
        } catch (unlockError: any) {
          console.error('[GovInsightStats] Failed to release refresh lock:', unlockError?.message || unlockError);
        }
      }
      lockClient?.release();
    }
  }

  private async refreshStatsV2(options: RefreshStatsOptions): Promise<boolean> {
    const targets = await this.resolveStatsV2Targets(options);
    let deleted = 0;
    let inserted = 0;

    for (const target of targets) {
      const result = await govInsightStatsV2Service.materialize(target);
      deleted += result.deleted;
      inserted += result.inserted;
    }

    console.log(`[GovInsightStats] Refreshed gov_open_annual_stats_v2 targets=${targets.length} deleted=${deleted} inserted=${inserted}`);
    return true;
  }

  private async resolveStatsV2Targets(options: RefreshStatsOptions): Promise<StatsTarget[]> {
    if (options.reportId) {
      const reportRes = await pool.query(
        `SELECT region_id, year
         FROM reports
         WHERE id = $1
           AND region_id IS NOT NULL
           AND year IS NOT NULL
         LIMIT 1`,
        [options.reportId]
      );
      const report = reportRes.rows?.[0];
      if (report?.region_id && report?.year) {
        return [{ regionId: Number(report.region_id), year: Number(report.year) }];
      }
    }

    if (options.batchId) {
      const batchRes = await pool.query(
        `SELECT DISTINCT r.year
         FROM reports r
         WHERE r.year IS NOT NULL
           AND (
             EXISTS (
               SELECT 1
               FROM jobs j
               WHERE j.report_id = r.id
                 AND j.ingestion_batch_id = $1
             )
             OR EXISTS (
               SELECT 1
               FROM report_versions rv
               WHERE rv.report_id = r.id
                 AND rv.ingestion_batch_id = $1
             )
           )
         ORDER BY r.year DESC`,
        [options.batchId]
      );
      const targets = batchRes.rows
        .map((row: any) => Number(row.year))
        .filter((year: number) => Number.isInteger(year) && year > 0)
        .map((year: number) => ({ year }));
      if (targets.length > 0) {
        return targets;
      }
    }

    if (options.versionId) {
      const versionRes = await pool.query(
        `SELECT r.region_id, r.year
         FROM report_versions rv
         JOIN reports r ON r.id = rv.report_id
         WHERE rv.id = $1
           AND r.region_id IS NOT NULL
           AND r.year IS NOT NULL
         LIMIT 1`,
        [options.versionId]
      );
      const report = versionRes.rows?.[0];
      if (report?.region_id && report?.year) {
        return [{ regionId: Number(report.region_id), year: Number(report.year) }];
      }
    }

    return [{}];
  }

  private async refreshLegacyMaterializedView(): Promise<boolean> {
    try {
      const viewRes = await pool.query(
        `SELECT relkind FROM pg_class WHERE relname = 'gov_open_annual_stats' LIMIT 1`
      );
      const relkind = viewRes.rows?.[0]?.relkind;
      if (relkind !== 'm') {
        console.warn(`[GovInsightStats] Skip legacy refresh: gov_open_annual_stats is not a materialized view (relkind=${relkind ?? 'missing'})`);
        return false;
      }

      await pool.query('REFRESH MATERIALIZED VIEW gov_open_annual_stats');
      return true;
    } catch (error: any) {
      console.error('[GovInsightStats] Legacy refresh failed:', error?.message || error);
      return false;
    }
  }
}

export const govInsightStatsService = new GovInsightStatsService();
