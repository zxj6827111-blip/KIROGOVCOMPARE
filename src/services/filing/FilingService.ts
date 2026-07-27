import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import pool from '../../config/database-llm';
import { DATA_DIR } from '../../config/constants';
import { resolveOrCreateReport, ReportUniqueConflictError, findReportIdByRegionYear } from '../reportIdentity';
import { materializeService } from '../data-center/MaterializeService';
import { consistencyCheckService } from '../ConsistencyCheckService';
import { buildBlankAnnualReportForm, ensureSixSectionForm, validateFilingFormStructure } from './BlankTemplateService';
import { evaluateFilingGate, type FilingGateResult } from './FilingGateService';
import { buildConsistencyRunSummary } from '../ConsistencyCheckService';
import { formatAllTextSections } from './textFormat';

export type FilingStatus = 'draft' | 'submitted' | 'checks_failed' | 'effective';

export type FilingRow = {
  id: number;
  region_id: number;
  year: number;
  report_id: number | null;
  status: FilingStatus;
  form_json: any;
  draft_version_id: number | null;
  effective_version_id: number | null;
  previous_active_version_id: number | null;
  last_check_run_id: number | null;
  last_check_summary_json: any;
  created_by: number | null;
  updated_by: number | null;
  submitted_at: string | null;
  effective_at: string | null;
  created_at: string;
  updated_at: string;
  region_name?: string;
  unit_name?: string;
  active_version_id?: number | null;
};

function parseJsonField(value: any): any {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function mapFiling(row: any): FilingRow {
  return {
    id: Number(row.id),
    region_id: Number(row.region_id),
    year: Number(row.year),
    report_id: row.report_id != null ? Number(row.report_id) : null,
    status: row.status as FilingStatus,
    form_json: parseJsonField(row.form_json) || {},
    draft_version_id: row.draft_version_id != null ? Number(row.draft_version_id) : null,
    effective_version_id: row.effective_version_id != null ? Number(row.effective_version_id) : null,
    previous_active_version_id:
      row.previous_active_version_id != null ? Number(row.previous_active_version_id) : null,
    last_check_run_id: row.last_check_run_id != null ? Number(row.last_check_run_id) : null,
    last_check_summary_json: parseJsonField(row.last_check_summary_json),
    created_by: row.created_by != null ? Number(row.created_by) : null,
    updated_by: row.updated_by != null ? Number(row.updated_by) : null,
    submitted_at: row.submitted_at || null,
    effective_at: row.effective_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    region_name: row.region_name,
    unit_name: row.unit_name,
    active_version_id: row.active_version_id != null ? Number(row.active_version_id) : null,
  };
}

const FILING_SELECT = `
  SELECT f.*,
         reg.name AS region_name,
         r.unit_name,
         r.active_version_id
  FROM report_filings f
  JOIN regions reg ON reg.id = f.region_id
  LEFT JOIN reports r ON r.id = f.report_id
`;

export class FilingService {
  async list(params: {
    year?: number;
    status?: string;
    regionId?: number;
    allowedRegionIds?: number[] | null;
  }): Promise<FilingRow[]> {
    const conditions: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (params.year) {
      conditions.push(`f.year = $${i++}`);
      values.push(params.year);
    }
    if (params.status) {
      conditions.push(`f.status = $${i++}`);
      values.push(params.status);
    }
    if (params.regionId) {
      // Include the selected node and all descendants (省/市/区筛选下级部门填报)
      conditions.push(`f.region_id IN (
        WITH RECURSIVE region_tree AS (
          SELECT id FROM regions WHERE id = $${i}
          UNION ALL
          SELECT r.id FROM regions r
          JOIN region_tree t ON r.parent_id = t.id
        )
        SELECT id FROM region_tree
      )`);
      values.push(params.regionId);
      i += 1;
    }
    if (params.allowedRegionIds && params.allowedRegionIds.length > 0) {
      conditions.push(`f.region_id = ANY($${i++}::bigint[])`);
      values.push(params.allowedRegionIds);
    } else if (params.allowedRegionIds && params.allowedRegionIds.length === 0) {
      return [];
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `${FILING_SELECT}
       ${where}
       ORDER BY f.year DESC, reg.name ASC, f.id DESC`,
      values
    );
    return result.rows.map(mapFiling);
  }

  async getById(id: number): Promise<FilingRow | null> {
    const result = await pool.query(`${FILING_SELECT} WHERE f.id = $1 LIMIT 1`, [id]);
    if (!result.rows[0]) return null;
    return mapFiling(result.rows[0]);
  }

  async createOrGet(params: {
    regionId: number;
    year: number;
    userId?: number;
  }): Promise<{ filing: FilingRow; created: boolean }> {
    const existing = await pool.query(
      `SELECT id FROM report_filings WHERE region_id = $1 AND year = $2 LIMIT 1`,
      [params.regionId, params.year]
    );
    if (existing.rows[0]?.id) {
      const filing = await this.getById(Number(existing.rows[0].id));
      return { filing: filing!, created: false };
    }

    const regionRes = await pool.query(`SELECT id, name FROM regions WHERE id = $1 LIMIT 1`, [
      params.regionId,
    ]);
    if (!regionRes.rows[0]) {
      throw Object.assign(new Error('region_not_found'), { code: 'REGION_NOT_FOUND' });
    }
    const unitName = String(regionRes.rows[0].name || '');

    let reportId: number | null = null;
    try {
      reportId = (await resolveOrCreateReport(params.regionId, params.year, unitName)).id;
    } catch (err) {
      if (err instanceof ReportUniqueConflictError) {
        reportId = await findReportIdByRegionYear(params.regionId, params.year);
      } else {
        throw err;
      }
    }

    const formJson = buildBlankAnnualReportForm({
      year: params.year,
      unitName,
      regionId: params.regionId,
    });

    try {
      const insert = await pool.query(
        `INSERT INTO report_filings (
           region_id, year, report_id, status, form_json, created_by, updated_by
         ) VALUES ($1, $2, $3, 'draft', $4::jsonb, $5, $5)
         RETURNING id`,
        [params.regionId, params.year, reportId, JSON.stringify(formJson), params.userId ?? null]
      );
      const filing = await this.getById(Number(insert.rows[0].id));
      return { filing: filing!, created: true };
    } catch (error: any) {
      if (error?.code === '23505') {
        const again = await pool.query(
          `SELECT id FROM report_filings WHERE region_id = $1 AND year = $2 LIMIT 1`,
          [params.regionId, params.year]
        );
        const filing = await this.getById(Number(again.rows[0].id));
        return { filing: filing!, created: false };
      }
      throw error;
    }
  }

  async updateDraft(id: number, formJson: any, userId?: number): Promise<FilingRow> {
    const filing = await this.getById(id);
    if (!filing) {
      throw Object.assign(new Error('filing_not_found'), { code: 'FILING_NOT_FOUND' });
    }
    if (filing.status !== 'draft' && filing.status !== 'checks_failed') {
      throw Object.assign(new Error('filing_not_editable'), {
        code: 'FILING_NOT_EDITABLE',
        status: filing.status,
      });
    }

    const normalized = ensureSixSectionForm(formJson, {
      year: filing.year,
      unitName: filing.region_name || filing.unit_name,
      regionId: filing.region_id,
    });
    const validation = validateFilingFormStructure(normalized);
    if (!validation.ok) {
      throw Object.assign(new Error(validation.errors.join('; ')), {
        code: 'INVALID_FORM',
        errors: validation.errors,
      });
    }

    await pool.query(
      `UPDATE report_filings
       SET form_json = $2::jsonb,
           updated_by = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [id, JSON.stringify(normalized), userId ?? null]
    );

    return (await this.getById(id))!;
  }

  async formatText(id: number, userId?: number): Promise<FilingRow> {
    const filing = await this.getById(id);
    if (!filing) {
      throw Object.assign(new Error('filing_not_found'), { code: 'FILING_NOT_FOUND' });
    }
    if (filing.status !== 'draft' && filing.status !== 'checks_failed') {
      throw Object.assign(new Error('filing_not_editable'), {
        code: 'FILING_NOT_EDITABLE',
        status: filing.status,
      });
    }
    const formatted = formatAllTextSections(filing.form_json);
    return this.updateDraft(id, formatted, userId);
  }

  /**
   * Persist form_json to disk so storage_path is a real source file.
   * Returns project-root-relative path: data/uploads/filings/...
   */
  private async writeFilingSourceFile(
    regionId: number,
    year: number,
    fileHash: string,
    formJson: any
  ): Promise<{ storagePath: string; fileSize: number }> {
    const fileName = `${fileHash.slice(0, 16)}.json`;
    const relPath = path.posix.join('data', 'uploads', 'filings', String(regionId), String(year), fileName);
    const absDir = path.join(DATA_DIR, 'uploads', 'filings', String(regionId), String(year));
    const absPath = path.join(absDir, fileName);
    await fsp.mkdir(absDir, { recursive: true });
    const body = JSON.stringify(formJson, null, 2);
    await fsp.writeFile(absPath, body, 'utf8');
    return { storagePath: relPath, fileSize: Buffer.byteLength(body, 'utf8') };
  }

  private async recoverSubmitFailure(
    id: number,
    userId: number | undefined,
    versionId: number,
    error: any
  ): Promise<void> {
    try {
      await pool.query(
        `UPDATE report_filings
         SET status = 'checks_failed',
             last_check_summary_json = $2::jsonb,
             updated_by = $3,
             updated_at = NOW()
         WHERE id = $1
           AND status = 'submitted'`,
        [
          id,
          JSON.stringify({
            passed: false,
            failCount: 1,
            fails: [
              {
                groupKey: 'structure',
                checkKey: 'submit_pipeline_error',
                title: '提交处理失败',
                expr: 'submit_pipeline',
                leftValue: null,
                rightValue: null,
                delta: null,
                autoStatus: 'FAIL',
              },
            ],
            warnings: [],
            error: error?.message || String(error),
            versionId: versionId || null,
          }),
          userId ?? null,
        ]
      );
    } catch (recoverErr) {
      console.error('[Filing] failed to recover submitted status:', recoverErr);
    }
  }

  async submit(id: number, userId?: number): Promise<{
    filing: FilingRow;
    gate: ReturnType<typeof evaluateFilingGate>;
    versionId: number;
    reportId: number;
  }> {
    // Resolve report_id before claim so unique conflicts never abort the claim txn.
    const pre = await this.getById(id);
    if (!pre) {
      throw Object.assign(new Error('filing_not_found'), { code: 'FILING_NOT_FOUND' });
    }
    if (pre.status === 'submitted') {
      throw Object.assign(new Error('填报正在提交处理中，请稍候或撤回为草稿后重试'), {
        code: 'FILING_SUBMIT_IN_PROGRESS',
        status: pre.status,
      });
    }
    if (pre.status !== 'draft' && pre.status !== 'checks_failed') {
      throw Object.assign(new Error('filing_not_submittable'), {
        code: 'FILING_NOT_SUBMITTABLE',
        status: pre.status,
      });
    }

    const formJson = ensureSixSectionForm(pre.form_json, {
      year: pre.year,
      unitName: pre.region_name || pre.unit_name || '',
      regionId: pre.region_id,
    });
    const validation = validateFilingFormStructure(formJson);
    if (!validation.ok) {
      throw Object.assign(new Error(validation.errors.join('; ')), {
        code: 'INVALID_FORM',
        errors: validation.errors,
      });
    }

    const unitName = pre.region_name || pre.unit_name || '';
    let reportId = pre.report_id || 0;
    if (!reportId) {
      try {
        reportId = (await resolveOrCreateReport(pre.region_id, pre.year, unitName)).id;
      } catch (err) {
        if (err instanceof ReportUniqueConflictError) {
          reportId = (await findReportIdByRegionYear(pre.region_id, pre.year)) || 0;
        } else {
          throw err;
        }
      }
    }
    if (!reportId) {
      throw Object.assign(new Error('report_resolve_failed'), { code: 'REPORT_RESOLVE_FAILED' });
    }

    // --- Phase 1: lock + claim + insert version (serialize concurrent submits) ---
    const client = await pool.connect();
    let versionId = 0;
    let storagePath = '';
    try {
      await client.query('BEGIN');

      const lockRes = await client.query(
        `SELECT id, status, region_id, year
         FROM report_filings
         WHERE id = $1
         FOR UPDATE`,
        [id]
      );
      if (!lockRes.rows[0]) {
        await client.query('ROLLBACK');
        throw Object.assign(new Error('filing_not_found'), { code: 'FILING_NOT_FOUND' });
      }
      const lockedStatus = String(lockRes.rows[0].status);
      if (lockedStatus === 'submitted') {
        await client.query('ROLLBACK');
        throw Object.assign(new Error('填报正在提交处理中，请稍候或撤回为草稿后重试'), {
          code: 'FILING_SUBMIT_IN_PROGRESS',
          status: lockedStatus,
        });
      }
      if (lockedStatus !== 'draft' && lockedStatus !== 'checks_failed') {
        await client.query('ROLLBACK');
        throw Object.assign(new Error('filing_not_submittable'), {
          code: 'FILING_NOT_SUBMITTABLE',
          status: lockedStatus,
        });
      }

      const claimRes = await client.query(
        `UPDATE report_filings
         SET status = 'submitted',
             report_id = $2,
             form_json = $3::jsonb,
             submitted_at = NOW(),
             updated_by = $4,
             updated_at = NOW()
         WHERE id = $1
           AND status IN ('draft', 'checks_failed')
         RETURNING id`,
        [id, reportId, JSON.stringify(formJson), userId ?? null]
      );
      if (!claimRes.rows[0]) {
        await client.query('ROLLBACK');
        throw Object.assign(new Error('填报正在提交处理中，请稍候'), {
          code: 'FILING_SUBMIT_IN_PROGRESS',
          status: 'submitted',
        });
      }

      const prevActiveRes = await client.query(
        `SELECT active_version_id FROM reports WHERE id = $1 LIMIT 1`,
        [reportId]
      );
      const previousActiveVersionId = prevActiveRes.rows[0]?.active_version_id
        ? Number(prevActiveRes.rows[0].active_version_id)
        : null;

      const fileHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(formJson))
        .update(`|${Date.now()}|${id}|${Math.random()}`)
        .digest('hex');

      const written = await this.writeFilingSourceFile(pre.region_id, pre.year, fileHash, formJson);
      storagePath = written.storagePath;

      const versionInsert = await client.query(
        `INSERT INTO report_versions (
           report_id, file_name, file_hash, file_size, storage_path,
           provider, model, prompt_version, parsed_json, schema_version,
           is_active, version_type, state, review_status, created_by, ingestion_mode
         ) VALUES (
           $1, $2, $3, $4, $5,
           'manual_filing', 'manual_filing', 'filing_v1', $6::jsonb, 'filing_v1',
           false, 'manual_filing', 'pending_review', 'pending_review', $7, 'manual_filing'
         )
         RETURNING id`,
        [
          reportId,
          `manual-filing-${pre.year}-${pre.region_id}.json`,
          fileHash,
          written.fileSize,
          storagePath,
          JSON.stringify(formJson),
          userId ?? null,
        ]
      );
      versionId = Number(versionInsert.rows[0].id);

      await client.query(
        `UPDATE report_filings
         SET draft_version_id = $2,
             previous_active_version_id = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [id, versionId, previousActiveVersionId]
      );

      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      if (storagePath && !versionId) {
        try {
          const abs = path.join(DATA_DIR, storagePath.replace(/^data[\\/]/, ''));
          if (fs.existsSync(abs)) await fsp.unlink(abs);
        } catch {
          /* ignore */
        }
      }
      // If claim succeeded then later steps failed before commit, recover status.
      await this.recoverSubmitFailure(id, userId, versionId, error);
      throw error;
    } finally {
      client.release();
    }

    // --- Phase 2: materialize + checks (outside claim lock) ---
    // Before 生效, re-verify status is still submitted (reopen/delete may have raced).
    try {
      const materializeResult = await materializeService.materializeVersion(versionId);
      if (!materializeResult.success) {
        console.warn(`[Filing] materialize failed for version ${versionId}:`, materializeResult.error);
        const materializeGate: FilingGateResult = {
          passed: false,
          failCount: 1,
          fails: [
            {
              groupKey: 'materialize',
              checkKey: 'materialize_failed',
              title: '结构化落库失败',
              expr: 'materializeVersion',
              leftValue: null,
              rightValue: null,
              delta: null,
              autoStatus: 'FAIL',
            },
          ],
          warnings: [],
          summary: buildConsistencyRunSummary([
            {
              groupKey: 'materialize',
              checkKey: 'materialize_failed',
              autoStatus: 'FAIL',
              humanStatus: 'pending',
            },
          ]),
        };
        await this.finishSubmitAsFailed(id, versionId, userId, null, materializeGate, materializeResult);
        const updated = (await this.getById(id))!;
        return { filing: updated, gate: materializeGate, versionId, reportId };
      }

      const { runId, items } = await consistencyCheckService.runAndPersist(versionId, formJson);
      const gate = evaluateFilingGate(items);

      if (gate.passed) {
        const activated = await this.tryActivateIfStillSubmitted(id, reportId, versionId, userId, runId, gate, materializeResult);
        if (!activated) {
          // Reopened/deleted mid-flight: do not leave report half-published.
          throw Object.assign(new Error('提交已取消（填报状态已变更），未生效'), {
            code: 'FILING_SUBMIT_CANCELLED',
          });
        }
      } else {
        await this.finishSubmitAsFailed(id, versionId, userId, runId, gate, materializeResult);
      }

      const updated = (await this.getById(id))!;
      return { filing: updated, gate, versionId, reportId };
    } catch (error: any) {
      await this.recoverSubmitFailure(id, userId, versionId, error);
      throw error;
    }
  }

  /** Mark checks_failed only if still submitted for this draft version. */
  private async finishSubmitAsFailed(
    id: number,
    versionId: number,
    userId: number | undefined,
    runId: number | null,
    gate: FilingGateResult,
    materializeResult: any
  ): Promise<void> {
    await pool.query(
      `UPDATE report_filings
       SET status = 'checks_failed',
           last_check_run_id = COALESCE($2, last_check_run_id),
           last_check_summary_json = $3::jsonb,
           updated_by = $4,
           updated_at = NOW()
       WHERE id = $1
         AND status = 'submitted'
         AND draft_version_id = $5`,
      [
        id,
        runId,
        JSON.stringify({
          passed: false,
          failCount: gate.failCount,
          fails: gate.fails,
          warnings: gate.warnings,
          summary: gate.summary,
          materialize: materializeResult,
        }),
        userId ?? null,
        versionId,
      ]
    );
  }

  /**
   * Activate only when filing is still claimed as submitted for this version.
   * Returns false if reopen/delete won the race.
   */
  private async tryActivateIfStillSubmitted(
    id: number,
    reportId: number,
    versionId: number,
    userId: number | undefined,
    runId: number,
    gate: FilingGateResult,
    materializeResult: any
  ): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockRes = await client.query(
        `SELECT id, status, draft_version_id
         FROM report_filings
         WHERE id = $1
         FOR UPDATE`,
        [id]
      );
      const row = lockRes.rows[0];
      if (
        !row ||
        String(row.status) !== 'submitted' ||
        Number(row.draft_version_id) !== versionId
      ) {
        await client.query('ROLLBACK');
        return false;
      }

      // Activate report version inside same txn as status flip when possible.
      await client.query(
        `UPDATE report_versions
         SET is_active = false, updated_at = NOW()
         WHERE report_id = $1`,
        [reportId]
      );
      await client.query(
        `UPDATE report_versions
         SET review_status = 'history', updated_at = NOW()
         WHERE report_id = $1
           AND id != $2
           AND review_status IN ('published', 'pending_review')`,
        [reportId, versionId]
      );
      await client.query(
        `UPDATE report_versions
         SET is_active = true,
             review_status = 'published',
             state = 'published',
             approved_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND report_id = $2`,
        [versionId, reportId]
      );
      await client.query(
        `UPDATE reports
         SET active_version_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [versionId, reportId]
      );
      const upd = await client.query(
        `UPDATE report_filings
         SET status = 'effective',
             effective_version_id = $2,
             last_check_run_id = $3,
             last_check_summary_json = $4::jsonb,
             effective_at = NOW(),
             updated_by = $5,
             updated_at = NOW()
         WHERE id = $1
           AND status = 'submitted'
           AND draft_version_id = $2
         RETURNING id`,
        [
          id,
          versionId,
          runId,
          JSON.stringify({
            passed: true,
            failCount: 0,
            fails: [],
            warnings: gate.warnings,
            summary: gate.summary,
            materialize: materializeResult,
          }),
          userId ?? null,
        ]
      );
      if (!upd.rows[0]) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query('COMMIT');
      return true;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async reopen(id: number, userId?: number): Promise<FilingRow> {
    const filing = await this.getById(id);
    if (!filing) {
      throw Object.assign(new Error('filing_not_found'), { code: 'FILING_NOT_FOUND' });
    }
    if (
      filing.status !== 'effective' &&
      filing.status !== 'checks_failed' &&
      filing.status !== 'submitted'
    ) {
      throw Object.assign(new Error('filing_not_reopenable'), {
        code: 'FILING_NOT_REOPENABLE',
        status: filing.status,
      });
    }

    await pool.query(
      `UPDATE report_filings
       SET status = 'draft',
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [id, userId ?? null]
    );
    return (await this.getById(id))!;
  }

  /**
   * Delete a non-effective filing draft.
   * Does not remove reports/active versions that already became effective.
   */
  async remove(id: number): Promise<{ id: number }> {
    const filing = await this.getById(id);
    if (!filing) {
      throw Object.assign(new Error('filing_not_found'), { code: 'FILING_NOT_FOUND' });
    }
    // effective 不可删；submitted 允许删除以解除异常卡住
    if (filing.status === 'effective') {
      throw Object.assign(new Error('已生效填报不可删除，请先撤回为草稿'), {
        code: 'FILING_NOT_DELETABLE',
        status: filing.status,
      });
    }

    // Clear FK pointers first so version rows can remain as history without blocking delete.
    await pool.query(
      `UPDATE report_filings
       SET draft_version_id = NULL,
           effective_version_id = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
    await pool.query(`DELETE FROM report_filings WHERE id = $1`, [id]);
    return { id };
  }
}

export const filingService = new FilingService();
