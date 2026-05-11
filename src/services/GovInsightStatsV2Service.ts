import pool from '../config/database-llm';
import { canonicalUnitsService } from './CanonicalUnitsService';
import {
  GOVINSIGHT_CANONICAL_MAPPING_VERSION,
  GOVINSIGHT_METRIC_VERSION,
} from './GovInsightReportProtocol';

interface MaterializeOptions {
  regionId?: number;
  year?: number;
}

export class GovInsightStatsV2Service {
  async materialize(options: MaterializeOptions = {}): Promise<{ deleted: number; inserted: number }> {
    await canonicalUnitsService.syncAll();

    const filters: string[] = [];
    const params: Array<number | string> = [];

    if (options.regionId) {
      params.push(options.regionId);
      filters.push(`r.region_id = $${params.length}`);
    }

    if (options.year) {
      params.push(options.year);
      filters.push(`r.year = $${params.length}`);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const deleteConditions: string[] = [];
      const deleteParams: Array<number | string> = [];

      if (options.regionId) {
        deleteParams.push(options.regionId);
        deleteConditions.push(`region_id = $${deleteParams.length}`);
      }

      if (options.year) {
        deleteParams.push(options.year);
        deleteConditions.push(`year = $${deleteParams.length}`);
      }

      const deleteWhere = deleteConditions.length ? `WHERE ${deleteConditions.join(' AND ')}` : '';
      const deleteRes = await client.query(`DELETE FROM gov_open_annual_stats_v2 ${deleteWhere}`, deleteParams);

      const insertSql = `
        WITH selected_reports AS (
          SELECT
            r.id AS report_id,
            r.region_id,
            reg.name AS org_name,
            r.year,
            cu.parent_region_id,
            cu.city_region_id,
            COALESCE(cu.unit_type, 'unknown') AS unit_type,
            COALESCE(cu.mapping_version, '${GOVINSIGHT_CANONICAL_MAPPING_VERSION}') AS mapping_version,
            rv_active.id AS active_version_id,
            rv_active.review_status AS active_review_status,
            (
              SELECT rv.id
              FROM report_versions rv
              WHERE rv.report_id = r.id
                AND rv.review_status = 'published'
              ORDER BY COALESCE(rv.approved_at, rv.created_at) DESC, rv.id DESC
              LIMIT 1
            ) AS published_version_id
          FROM reports r
          JOIN regions reg ON reg.id = r.region_id
          LEFT JOIN canonical_units cu ON cu.region_id = r.region_id
          LEFT JOIN report_versions rv_active ON rv_active.id = r.active_version_id
          ${whereClause}
        ),
        selected_versions AS (
          SELECT
            sr.*,
            CASE
              WHEN sr.unit_type = 'unknown' THEN 'blocked_unknown_unit_type'
              WHEN sr.parent_region_id IS NULL AND sr.unit_type <> 'province' THEN 'blocked_mapping_pending'
              WHEN sr.city_region_id IS NULL AND sr.unit_type NOT IN ('province', 'city') THEN 'blocked_mapping_pending'
              WHEN sr.active_version_id IS NOT NULL AND sr.active_review_status = 'published' THEN 'official'
              WHEN sr.published_version_id IS NOT NULL THEN 'official'
              WHEN sr.active_version_id IS NOT NULL THEN 'preview'
              ELSE 'blocked_missing_facts'
            END AS materialize_status,
            CASE
              WHEN sr.active_version_id IS NOT NULL AND sr.active_review_status = 'published' THEN sr.active_version_id
              WHEN sr.published_version_id IS NOT NULL THEN sr.published_version_id
              WHEN sr.active_version_id IS NOT NULL THEN sr.active_version_id
              ELSE NULL
            END AS source_report_version_id
          FROM selected_reports sr
        ),
        active_disclosure_pivot AS (
          SELECT
            fad.report_id,
            fad.version_id,
            COUNT(*) AS fact_row_count,
            SUM(CASE WHEN fad.category = 'regulations' THEN fad.made_count ELSE 0 END) AS reg_published,
            SUM(CASE WHEN fad.category = 'regulations' THEN fad.valid_count ELSE 0 END) AS reg_active,
            SUM(CASE WHEN fad.category = 'regulations' THEN fad.repealed_count ELSE 0 END) AS reg_abolished,
            SUM(CASE WHEN fad.category = 'normative_documents' THEN fad.made_count ELSE 0 END) AS doc_published,
            SUM(CASE WHEN fad.category = 'normative_documents' THEN fad.valid_count ELSE 0 END) AS doc_active,
            SUM(CASE WHEN fad.category = 'normative_documents' THEN fad.repealed_count ELSE 0 END) AS doc_abolished,
            SUM(CASE WHEN fad.category = 'licensing' THEN COALESCE(fad.processed_count, 0) ELSE 0 END) AS action_licensing,
            SUM(CASE WHEN fad.category = 'punishment' THEN COALESCE(fad.processed_count, 0) ELSE 0 END) AS action_punishment,
            SUM(CASE WHEN fad.category = 'coercion' THEN COALESCE(fad.processed_count, 0) ELSE 0 END) AS action_force,
            SUM(CASE WHEN fad.category = 'fees' THEN COALESCE(fad.amount, 0) ELSE 0 END) AS fees_amount
          FROM fact_active_disclosure fad
          JOIN selected_versions sv
            ON sv.report_id = fad.report_id
           AND sv.source_report_version_id = fad.version_id
          GROUP BY fad.report_id, fad.version_id
        ),
        application_pivot AS (
          SELECT
            fa.report_id,
            fa.version_id,
            COUNT(*) AS fact_row_count,
            SUM(CASE WHEN fa.response_type = 'new_received' THEN fa.count ELSE 0 END) AS app_new,
            SUM(CASE WHEN fa.response_type = 'carried_over' THEN fa.count ELSE 0 END) AS app_carried_over,
            SUM(CASE WHEN fa.applicant_type = 'natural_person' AND fa.response_type = 'new_received' THEN fa.count ELSE 0 END) AS source_natural,
            SUM(CASE WHEN fa.response_type IN ('granted', 'public') THEN fa.count ELSE 0 END) AS outcome_public,
            SUM(CASE WHEN fa.response_type IN ('partial_grant', 'partial') THEN fa.count ELSE 0 END) AS outcome_partial,
            SUM(CASE WHEN fa.response_type IN ('unable_to_provide', 'unable', 'unable_no_info', 'unable_need_creation', 'unable_unclear') THEN fa.count ELSE 0 END) AS outcome_unable,
            SUM(CASE WHEN fa.response_type = 'unable_no_info' THEN fa.count ELSE 0 END) AS outcome_unable_no_info,
            SUM(CASE WHEN fa.response_type = 'unable_need_creation' THEN fa.count ELSE 0 END) AS outcome_unable_need_creation,
            SUM(CASE WHEN fa.response_type = 'unable_unclear' THEN fa.count ELSE 0 END) AS outcome_unable_unclear,
            SUM(CASE WHEN fa.response_type IN ('denied', 'not_open', 'denied_law_forbidden', 'denied_state_secret', 'not_open_danger', 'denied_safety_stability', 'not_open_process', 'denied_process_info', 'not_open_internal', 'denied_internal_affairs', 'not_open_third_party', 'denied_third_party_rights', 'denied_enforcement_case', 'not_open_admin_query', 'denied_admin_query') THEN fa.count ELSE 0 END) AS outcome_not_open,
            SUM(CASE WHEN fa.response_type = 'denied_state_secret' THEN fa.count ELSE 0 END) AS outcome_not_open_state_secret,
            SUM(CASE WHEN fa.response_type = 'denied_law_forbidden' THEN fa.count ELSE 0 END) AS outcome_not_open_law_forbidden,
            SUM(CASE WHEN fa.response_type IN ('not_open_danger', 'denied_safety_stability') THEN fa.count ELSE 0 END) AS outcome_not_open_danger,
            SUM(CASE WHEN fa.response_type IN ('not_open_process', 'denied_process_info') THEN fa.count ELSE 0 END) AS outcome_not_open_process,
            SUM(CASE WHEN fa.response_type IN ('not_open_internal', 'denied_internal_affairs') THEN fa.count ELSE 0 END) AS outcome_not_open_internal,
            SUM(CASE WHEN fa.response_type IN ('not_open_third_party', 'denied_third_party_rights') THEN fa.count ELSE 0 END) AS outcome_not_open_third_party,
            SUM(CASE WHEN fa.response_type = 'denied_enforcement_case' THEN fa.count ELSE 0 END) AS outcome_not_open_enforcement,
            SUM(CASE WHEN fa.response_type IN ('not_open_admin_query', 'denied_admin_query') THEN fa.count ELSE 0 END) AS outcome_not_open_admin_query,
            SUM(CASE WHEN fa.response_type IN ('ignored', 'not_processed_complaint', 'not_processed_confirm_info', 'ignore_repeat', 'not_processed_repeat', 'not_processed_publication', 'not_processed_massive_requests') THEN fa.count ELSE 0 END) AS outcome_ignore,
            SUM(CASE WHEN fa.response_type = 'not_processed_complaint' THEN fa.count ELSE 0 END) AS outcome_complaint,
            SUM(CASE WHEN fa.response_type IN ('ignore_repeat', 'not_processed_repeat') THEN fa.count ELSE 0 END) AS outcome_ignore_repeat,
            SUM(CASE WHEN fa.response_type = 'not_processed_publication' THEN fa.count ELSE 0 END) AS outcome_publication,
            SUM(CASE WHEN fa.response_type = 'not_processed_massive_requests' THEN fa.count ELSE 0 END) AS outcome_massive,
            SUM(CASE WHEN fa.response_type = 'not_processed_confirm_info' THEN fa.count ELSE 0 END) AS outcome_confirm,
            SUM(CASE WHEN fa.response_type IN ('other', 'outcome_other', 'other_other_reasons', 'other_overdue_correction', 'other_overdue_fee') THEN fa.count ELSE 0 END) AS outcome_other,
            SUM(CASE WHEN fa.response_type = 'other_overdue_correction' THEN fa.count ELSE 0 END) AS outcome_overdue_correction,
            SUM(CASE WHEN fa.response_type = 'other_overdue_fee' THEN fa.count ELSE 0 END) AS outcome_overdue_fee,
            SUM(CASE WHEN fa.response_type IN ('outcome_other', 'other_other_reasons') THEN fa.count ELSE 0 END) AS outcome_other_reasons,
            SUM(CASE WHEN fa.response_type = 'carried_forward' THEN fa.count ELSE 0 END) AS app_carried_forward
          FROM fact_application fa
          JOIN selected_versions sv
            ON sv.report_id = fa.report_id
           AND sv.source_report_version_id = fa.version_id
          WHERE fa.applicant_type <> 'total'
          GROUP BY fa.report_id, fa.version_id
        ),
        legal_pivot AS (
          SELECT
            flp.report_id,
            flp.version_id,
            COUNT(*) AS fact_row_count,
            SUM(CASE WHEN flp.case_type = 'review' AND flp.result_type = 'total' THEN flp.count ELSE 0 END) AS rev_total,
            SUM(CASE WHEN flp.case_type = 'review' AND flp.result_type = 'correct' THEN flp.count ELSE 0 END) AS rev_corrected,
            SUM(CASE WHEN flp.case_type IN ('litigation_direct', 'litigation_post_review') AND flp.result_type = 'total' THEN flp.count ELSE 0 END) AS lit_total,
            SUM(CASE WHEN flp.case_type IN ('litigation_direct', 'litigation_post_review') AND flp.result_type = 'correct' THEN flp.count ELSE 0 END) AS lit_corrected
          FROM fact_legal_proceeding flp
          JOIN selected_versions sv
            ON sv.report_id = flp.report_id
           AND sv.source_report_version_id = flp.version_id
          GROUP BY flp.report_id, flp.version_id
        ),
        final_rows AS (
          SELECT
            sv.region_id,
            sv.parent_region_id,
            sv.city_region_id,
            sv.unit_type,
            CONCAT(sv.unit_type, '_', sv.region_id) AS org_id,
            sv.org_name,
            sv.year,
            CASE
              WHEN sv.materialize_status IN ('blocked_mapping_pending', 'blocked_unknown_unit_type') THEN sv.materialize_status
              WHEN COALESCE(ad.fact_row_count, 0) + COALESCE(ap.fact_row_count, 0) + COALESCE(lp.fact_row_count, 0) = 0 THEN 'blocked_missing_facts'
              ELSE sv.materialize_status
            END AS materialize_status,
            sv.report_id AS source_report_id,
            sv.source_report_version_id,
            NOW() AS stats_snapshot_at,
            '${GOVINSIGHT_METRIC_VERSION}' AS metric_version,
            sv.mapping_version,
            COALESCE(ad.reg_published, 0) AS reg_published,
            COALESCE(ad.reg_active, 0) AS reg_active,
            COALESCE(ad.reg_abolished, 0) AS reg_abolished,
            COALESCE(ad.doc_published, 0) AS doc_published,
            COALESCE(ad.doc_active, 0) AS doc_active,
            COALESCE(ad.doc_abolished, 0) AS doc_abolished,
            COALESCE(ad.action_licensing, 0) AS action_licensing,
            COALESCE(ad.action_punishment, 0) AS action_punishment,
            COALESCE(ad.action_force, 0) AS action_force,
            COALESCE(ad.fees_amount, 0) AS fees_amount,
            COALESCE(ap.app_new, 0) AS app_new,
            COALESCE(ap.app_carried_over, 0) AS app_carried_over,
            COALESCE(ap.source_natural, 0) AS source_natural,
            COALESCE(ap.outcome_public, 0) AS outcome_public,
            COALESCE(ap.outcome_partial, 0) AS outcome_partial,
            COALESCE(ap.outcome_unable, 0) AS outcome_unable,
            COALESCE(ap.outcome_unable_no_info, 0) AS outcome_unable_no_info,
            COALESCE(ap.outcome_unable_need_creation, 0) AS outcome_unable_need_creation,
            COALESCE(ap.outcome_unable_unclear, 0) AS outcome_unable_unclear,
            COALESCE(ap.outcome_not_open, 0) AS outcome_not_open,
            COALESCE(ap.outcome_not_open_state_secret, 0) AS outcome_not_open_state_secret,
            COALESCE(ap.outcome_not_open_law_forbidden, 0) AS outcome_not_open_law_forbidden,
            COALESCE(ap.outcome_not_open_danger, 0) AS outcome_not_open_danger,
            COALESCE(ap.outcome_not_open_process, 0) AS outcome_not_open_process,
            COALESCE(ap.outcome_not_open_internal, 0) AS outcome_not_open_internal,
            COALESCE(ap.outcome_not_open_third_party, 0) AS outcome_not_open_third_party,
            COALESCE(ap.outcome_not_open_enforcement, 0) AS outcome_not_open_enforcement,
            COALESCE(ap.outcome_not_open_admin_query, 0) AS outcome_not_open_admin_query,
            COALESCE(ap.outcome_ignore, 0) AS outcome_ignore,
            COALESCE(ap.outcome_complaint, 0) AS outcome_complaint,
            COALESCE(ap.outcome_ignore_repeat, 0) AS outcome_ignore_repeat,
            COALESCE(ap.outcome_publication, 0) AS outcome_publication,
            COALESCE(ap.outcome_massive, 0) AS outcome_massive,
            COALESCE(ap.outcome_confirm, 0) AS outcome_confirm,
            COALESCE(ap.outcome_other, 0) AS outcome_other,
            COALESCE(ap.outcome_overdue_correction, 0) AS outcome_overdue_correction,
            COALESCE(ap.outcome_overdue_fee, 0) AS outcome_overdue_fee,
            COALESCE(ap.outcome_other_reasons, 0) AS outcome_other_reasons,
            COALESCE(ap.app_carried_forward, 0) AS app_carried_forward,
            COALESCE(lp.rev_total, 0) AS rev_total,
            COALESCE(lp.rev_corrected, 0) AS rev_corrected,
            COALESCE(lp.lit_total, 0) AS lit_total,
            COALESCE(lp.lit_corrected, 0) AS lit_corrected
          FROM selected_versions sv
          LEFT JOIN active_disclosure_pivot ad
            ON ad.report_id = sv.report_id
           AND ad.version_id = sv.source_report_version_id
          LEFT JOIN application_pivot ap
            ON ap.report_id = sv.report_id
           AND ap.version_id = sv.source_report_version_id
          LEFT JOIN legal_pivot lp
            ON lp.report_id = sv.report_id
           AND lp.version_id = sv.source_report_version_id
        )
        INSERT INTO gov_open_annual_stats_v2 (
          region_id,
          parent_region_id,
          city_region_id,
          unit_type,
          org_id,
          org_name,
          year,
          materialize_status,
          is_official,
          source_report_id,
          source_report_version_id,
          stats_snapshot_at,
          metric_version,
          mapping_version,
          reg_published,
          reg_active,
          reg_abolished,
          doc_published,
          doc_active,
          doc_abolished,
          action_licensing,
          action_punishment,
          action_force,
          fees_amount,
          app_new,
          app_carried_over,
          source_natural,
          outcome_public,
          outcome_partial,
          outcome_unable,
          outcome_unable_no_info,
          outcome_unable_need_creation,
          outcome_unable_unclear,
          outcome_not_open,
          outcome_not_open_state_secret,
          outcome_not_open_law_forbidden,
          outcome_not_open_danger,
          outcome_not_open_process,
          outcome_not_open_internal,
          outcome_not_open_third_party,
          outcome_not_open_enforcement,
          outcome_not_open_admin_query,
          outcome_ignore,
          outcome_complaint,
          outcome_ignore_repeat,
          outcome_publication,
          outcome_massive,
          outcome_confirm,
          outcome_other,
          outcome_overdue_correction,
          outcome_overdue_fee,
          outcome_other_reasons,
          app_carried_forward,
          rev_total,
          rev_corrected,
          lit_total,
          lit_corrected,
          created_at,
          updated_at
        )
        SELECT
          region_id,
          parent_region_id,
          city_region_id,
          unit_type,
          org_id,
          org_name,
          year,
          materialize_status,
          CASE WHEN materialize_status = 'official' THEN TRUE ELSE FALSE END AS is_official,
          source_report_id,
          source_report_version_id,
          stats_snapshot_at,
          metric_version,
          mapping_version,
          reg_published,
          reg_active,
          reg_abolished,
          doc_published,
          doc_active,
          doc_abolished,
          action_licensing,
          action_punishment,
          action_force,
          fees_amount,
          app_new,
          app_carried_over,
          source_natural,
          outcome_public,
          outcome_partial,
          outcome_unable,
          outcome_unable_no_info,
          outcome_unable_need_creation,
          outcome_unable_unclear,
          outcome_not_open,
          outcome_not_open_state_secret,
          outcome_not_open_law_forbidden,
          outcome_not_open_danger,
          outcome_not_open_process,
          outcome_not_open_internal,
          outcome_not_open_third_party,
          outcome_not_open_enforcement,
          outcome_not_open_admin_query,
          outcome_ignore,
          outcome_complaint,
          outcome_ignore_repeat,
          outcome_publication,
          outcome_massive,
          outcome_confirm,
          outcome_other,
          outcome_overdue_correction,
          outcome_overdue_fee,
          outcome_other_reasons,
          app_carried_forward,
          rev_total,
          rev_corrected,
          lit_total,
          lit_corrected,
          NOW(),
          NOW()
        FROM final_rows
      `;

      const insertRes = await client.query(insertSql, params);
      await client.query('COMMIT');
      return { deleted: deleteRes.rowCount ?? 0, inserted: insertRes.rowCount ?? 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getBestAvailableRow(regionId: number, year: number): Promise<Record<string, any> | null> {
    const result = await pool.query(
      `
      SELECT *
      FROM gov_open_annual_stats_v2
      WHERE region_id = $1 AND year = $2
      ORDER BY
        CASE materialize_status
          WHEN 'official' THEN 0
          WHEN 'preview' THEN 1
          WHEN 'blocked_mapping_pending' THEN 2
          WHEN 'blocked_unknown_unit_type' THEN 3
          ELSE 4
        END ASC,
        updated_at DESC
      LIMIT 1
      `,
      [regionId, year]
    );

    return result.rows[0] || null;
  }
}

export const govInsightStatsV2Service = new GovInsightStatsV2Service();
