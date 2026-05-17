import pool from '../config/database-llm';
import { consistencyCheckService } from './ConsistencyCheckService';
import { materializeService } from './data-center/MaterializeService';
import { visionReviewService } from './VisionReviewService';

type ParsedJson = Record<string, any>;
type CorrectionAction = 'confirm' | 'reject';

interface CorrectionRow {
  id: number;
  report_id: number;
  report_version_id: number;
  field_path: string;
  ocr_value: unknown;
  status: string;
}

function parseDbJson(value: unknown): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function jsonParam(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizePath(path: string): string[] {
  return String(path || '')
    .replace(/^activeDisclosureData\./, 'activeDisclosureData.')
    .replace(/^tableData\./, 'tableData.')
    .replace(/^reviewLitigationData\./, 'reviewLitigationData.')
    .split('.')
    .filter(Boolean);
}

function findSection(parsed: ParsedJson, payloadKey: string): Record<string, any> | null {
  if (Array.isArray(parsed.sections)) {
    const section = parsed.sections.find((item: any) => item && typeof item === 'object' && item[payloadKey]);
    if (section) return section;
  }
  return parsed;
}

function setParsedValue(parsed: ParsedJson, fieldPath: string, value: unknown): void {
  const parts = normalizePath(fieldPath);
  const payloadKey = parts.shift();
  if (!payloadKey) return;

  const section = findSection(parsed, payloadKey);
  if (!section) return;
  if (!section[payloadKey] || typeof section[payloadKey] !== 'object') {
    section[payloadKey] = {};
  }

  let target = section[payloadKey];
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!target[key] || typeof target[key] !== 'object') {
      target[key] = {};
    }
    target = target[key];
  }
  target[parts[parts.length - 1]] = value;
}

export class OcrCorrectionService {
  async resolveCorrections(
    reportId: number,
    versionId: number,
    correctionIds: number[],
    action: CorrectionAction,
    userId?: number | null
  ): Promise<{ corrections: any[]; materialized?: boolean; factsCreated?: number; cellsCreated?: number; checksRunId?: number; checksSummary?: Record<string, number>; visionReviewsQueued?: number }> {
    if (!Number.isInteger(reportId) || reportId <= 0) throw new Error('invalid_report_id');
    if (!Number.isInteger(versionId) || versionId <= 0) throw new Error('invalid_version_id');
    if (!Array.isArray(correctionIds) || correctionIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new Error('invalid_correction_ids');
    }
    if (!['confirm', 'reject'].includes(action)) throw new Error('invalid_action');
    if (correctionIds.length === 0) return { corrections: [] };

    const client = await pool.connect();
    let appliedParsedJson: ParsedJson | null = null;
    let rows: CorrectionRow[] = [];

    try {
      await client.query('BEGIN');

      const versionResult = await client.query(
        `SELECT id, report_id, parsed_json
         FROM report_versions
         WHERE id = $1 AND report_id = $2
         FOR UPDATE`,
        [versionId, reportId]
      );
      const version = versionResult.rows[0];
      if (!version) throw new Error('version_not_found');

      const correctionResult = await client.query<CorrectionRow>(
        `SELECT id, report_id, report_version_id, field_path, ocr_value, status
         FROM ocr_corrections
         WHERE report_id = $1
           AND report_version_id = $2
           AND id = ANY($3::bigint[])
         FOR UPDATE`,
        [reportId, versionId, correctionIds]
      );
      rows = correctionResult.rows;
      if (rows.length !== correctionIds.length) throw new Error('correction_not_found');
      if (rows.some((row) => row.status !== 'pending')) throw new Error('correction_not_pending');

      if (action === 'confirm') {
        const parsed = cloneJson(parseDbJson(version.parsed_json) || {});
        for (const row of rows) {
          setParsedValue(parsed, row.field_path, parseDbJson(row.ocr_value));
        }
        appliedParsedJson = parsed;

        await client.query(
          `UPDATE report_versions
           SET parsed_json = $1::jsonb,
               version_type = CASE WHEN version_type = 'original_parse' THEN 'ocr_corrected' ELSE version_type END,
               change_reason = 'ocr_correction_confirmed',
               changed_fields_summary = $2,
               review_status = CASE WHEN review_status = 'published' THEN 'pending_review' ELSE review_status END,
               updated_at = NOW()
           WHERE id = $3`,
          [
            jsonParam(parsed),
            rows.map((row) => row.field_path).join(', '),
            versionId,
          ]
        );

        await client.query(
          `UPDATE parse_runs
           SET output_json = $1::jsonb
           WHERE report_version_id = $2
             AND is_current = TRUE
             AND status = 'accepted'`,
          [jsonParam(parsed), versionId]
        );

        await client.query(
          `UPDATE ocr_corrections
           SET status = 'confirmed',
               applied_at = NOW(),
               resolved_at = NOW(),
               resolved_by = $1,
               updated_at = NOW()
           WHERE id = ANY($2::bigint[])`,
          [userId ?? null, correctionIds]
        );
      } else {
        await client.query(
          `UPDATE ocr_corrections
           SET status = 'rejected',
               resolved_at = NOW(),
               resolved_by = $1,
               updated_at = NOW()
           WHERE id = ANY($2::bigint[])`,
          [userId ?? null, correctionIds]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    let materialized = false;
    let factsCreated = 0;
    let cellsCreated = 0;
    let checksRunId: number | undefined;
    let checksSummary: Record<string, number> | undefined;
    let visionReviewsQueued: number | undefined;
    if (action === 'confirm' && appliedParsedJson) {
      const materializeResult = await materializeService.materializeVersion(versionId);
      if (!materializeResult.success) {
        throw new Error(`ocr_materialize_failed:${materializeResult.error || 'unknown'}`);
      }
      materialized = true;
      factsCreated = materializeResult.factsCreated;
      cellsCreated = materializeResult.cellsCreated;

      const consistencyResult = await consistencyCheckService.runAndPersist(versionId, appliedParsedJson);
      checksRunId = consistencyResult.runId;
      checksSummary = {
        fail: consistencyResult.items.filter((item) => item.autoStatus === 'FAIL').length,
        uncertain: consistencyResult.items.filter((item) => item.autoStatus === 'UNCERTAIN').length,
        pass: consistencyResult.items.filter((item) => item.autoStatus === 'PASS').length,
        notAssessable: consistencyResult.items.filter((item) => item.autoStatus === 'NOT_ASSESSABLE').length,
        total: consistencyResult.items.length,
      };
      visionReviewsQueued = await visionReviewService.enqueueForConsistencyItems(
        reportId,
        versionId,
        consistencyResult.items,
        true
      );
    }

    const updated = await pool.query(
      `SELECT *
       FROM ocr_corrections
       WHERE report_id = $1
         AND report_version_id = $2
         AND id = ANY($3::bigint[])
       ORDER BY id ASC`,
      [reportId, versionId, correctionIds]
    );

    return {
      corrections: updated.rows.map((row) => ({
        id: Number(row.id),
        reportId: Number(row.report_id),
        reportVersionId: Number(row.report_version_id),
        reviewId: Number(row.review_id),
        tableId: row.table_id,
        fieldPath: row.field_path,
        parsedValue: parseDbJson(row.parsed_value),
        ocrValue: parseDbJson(row.ocr_value),
        status: row.status,
        appliedAt: row.applied_at,
        resolvedAt: row.resolved_at,
        resolvedBy: row.resolved_by === null || row.resolved_by === undefined ? null : Number(row.resolved_by),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      materialized,
      factsCreated,
      cellsCreated,
      checksRunId,
      checksSummary,
      visionReviewsQueued,
    };
  }
}

export const ocrCorrectionService = new OcrCorrectionService();
