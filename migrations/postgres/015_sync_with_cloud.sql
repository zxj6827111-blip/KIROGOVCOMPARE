-- Sync with Cloud Database Schema
-- 2024-02-06
-- 该脚本用于将本地数据库结构与云端生产数据库 gov_data.sql 保持一致

-- 1. 删除旧的/废弃的表结构 (不再使用的旧架构表)
DROP TABLE IF EXISTS parse_cache CASCADE;
DROP TABLE IF EXISTS batch_jobs CASCADE;
DROP TABLE IF EXISTS ai_suggestions CASCADE;
DROP TABLE IF EXISTS export_jobs CASCADE;
DROP TABLE IF EXISTS diff_results CASCADE; -- 注意：新表是 comparison_results
DROP TABLE IF EXISTS compare_tasks CASCADE;
DROP TABLE IF EXISTS report_assets CASCADE;

-- 2. 修改现有表结构以匹配云端

-- 修改 report_versions 表，添加一致性检查统计字段
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS check_total INTEGER;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS check_visual INTEGER;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS check_structure INTEGER;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS check_quality INTEGER;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS checks_updated_at TIMESTAMPTZ;

-- 修改 ingestion_batches 表，添加刷新时间字段
ALTER TABLE ingestion_batches ADD COLUMN IF NOT EXISTS stats_refreshed_at TIMESTAMPTZ;

-- 3. 创建云端存在但本地缺失的表

-- ai_decision_reports
CREATE TABLE IF NOT EXISTS ai_decision_reports (
    id BIGSERIAL PRIMARY KEY,
    region_id BIGINT,
    org_name VARCHAR(255),
    year INTEGER NOT NULL,
    content_json JSONB NOT NULL,
    model_used VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- comparison_exports
CREATE TABLE IF NOT EXISTS comparison_exports (
    id SERIAL PRIMARY KEY,
    comparison_id INTEGER,
    format TEXT DEFAULT 'pdf' NOT NULL,
    file_path TEXT,
    file_size INTEGER,
    watermark_text TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- report_consistency_check_runs (旧的一致性检查运行表，云端仍保留)
CREATE TABLE IF NOT EXISTS report_consistency_check_runs (
    id SERIAL PRIMARY KEY,
    report_version_id INTEGER NOT NULL,
    engine_version TEXT,
    total_items INTEGER DEFAULT 0,
    pass_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- users (普通用户表，与 admin_users 并存)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    data_scope TEXT DEFAULT '{}'
);

-- 4. 升级视图为物化视图
-- 云端使用的是 MATERIALIZED VIEW 以提高性能

DROP VIEW IF EXISTS gov_open_annual_stats CASCADE;
DROP MATERIALIZED VIEW IF EXISTS gov_open_annual_stats; 

CREATE MATERIALIZED VIEW gov_open_annual_stats AS
WITH RECURSIVE
base AS (
  SELECT
    r.id AS report_id,
    reg.id AS region_id,
    reg.name AS org_name,
    reg.level,
    reg.parent_id,
    parent.level AS parent_level, 
    r.year,
    r.active_version_id AS version_id
  FROM regions reg
  LEFT JOIN regions parent ON parent.id = reg.parent_id
  LEFT JOIN reports r ON r.region_id = reg.id AND r.active_version_id IS NOT NULL
),
active_disclosure_pivot AS (
  SELECT
    fad.report_id,
    fad.version_id,
    SUM(CASE WHEN fad.category = 'regulations' THEN fad.made_count ELSE 0 END) AS reg_published,
    SUM(CASE WHEN fad.category = 'regulations' THEN fad.valid_count ELSE 0 END) AS reg_active,
    SUM(CASE WHEN fad.category = 'regulations' THEN fad.repealed_count ELSE 0 END) AS reg_abolished,
    SUM(CASE WHEN fad.category = 'normative_documents' THEN fad.made_count ELSE 0 END) AS doc_published,
    SUM(CASE WHEN fad.category = 'normative_documents' THEN fad.valid_count ELSE 0 END) AS doc_active,
    SUM(CASE WHEN fad.category = 'normative_documents' THEN fad.repealed_count ELSE 0 END) AS doc_abolished,
    SUM(CASE WHEN fad.category = 'licensing' THEN COALESCE(fad.processed_count, 0) ELSE 0 END) AS action_licensing,
    SUM(CASE WHEN fad.category = 'punishment' THEN COALESCE(fad.processed_count, 0) ELSE 0 END) AS action_punishment
  FROM fact_active_disclosure fad
  GROUP BY fad.report_id, fad.version_id
),
application_pivot AS (
  SELECT
    fa.report_id,
    fa.version_id,
    SUM(CASE WHEN fa.response_type = 'new_received' THEN fa.count ELSE 0 END) AS app_new,
    SUM(CASE WHEN fa.response_type = 'carried_over' THEN fa.count ELSE 0 END) AS app_carried_over,
    SUM(CASE WHEN fa.applicant_type = 'natural_person' AND fa.response_type = 'new_received' THEN fa.count ELSE 0 END) AS source_natural,
    SUM(CASE WHEN fa.response_type IN ('granted', 'public') THEN fa.count ELSE 0 END) AS outcome_public,
    SUM(CASE WHEN fa.response_type IN ('partial_grant', 'partial') THEN fa.count ELSE 0 END) AS outcome_partial,
    SUM(CASE WHEN fa.response_type IN ('unable_to_provide', 'unable', 'unable_no_info', 'unable_need_creation', 'unable_unclear') THEN fa.count ELSE 0 END) AS outcome_unable,
    SUM(CASE WHEN fa.response_type = 'unable_no_info' THEN fa.count ELSE 0 END) AS outcome_unable_no_info,
    SUM(CASE WHEN fa.response_type = 'unable_need_creation' THEN fa.count ELSE 0 END) AS outcome_unable_need_creation,
    SUM(CASE WHEN fa.response_type = 'unable_unclear' THEN fa.count ELSE 0 END) AS outcome_unable_unclear,
    SUM(CASE WHEN fa.response_type IN ('denied', 'not_open', 'denied_law_forbidden', 'denied_state_secret', 'not_open_danger', 'denied_safety_stability', 'not_open_process', 'denied_process_info', 'not_open_internal', 'denied_internal_affairs', 'not_open_third_party', 'denied_third_party_rights', 'denied_enforcement_case') THEN fa.count ELSE 0 END) AS outcome_not_open,
    SUM(CASE WHEN fa.response_type IN ('not_open_danger', 'denied_safety_stability') THEN fa.count ELSE 0 END) AS outcome_not_open_danger,
    SUM(CASE WHEN fa.response_type IN ('not_open_process', 'denied_process_info') THEN fa.count ELSE 0 END) AS outcome_not_open_process,
    SUM(CASE WHEN fa.response_type IN ('not_open_internal', 'denied_internal_affairs') THEN fa.count ELSE 0 END) AS outcome_not_open_internal,
    SUM(CASE WHEN fa.response_type IN ('not_open_third_party', 'denied_third_party_rights') THEN fa.count ELSE 0 END) AS outcome_not_open_third_party,
    SUM(CASE WHEN fa.response_type IN ('not_open_admin_query', 'denied_admin_query') THEN fa.count ELSE 0 END) AS outcome_not_open_admin_query,
    SUM(CASE WHEN fa.response_type IN ('ignored', 'other', 'not_processed_complaint', 'not_processed_confirm_info', 'ignore_repeat', 'not_processed_repeat', 'other_other_reasons', 'other_overdue_correction', 'other_overdue_fee') THEN fa.count ELSE 0 END) AS outcome_ignore,
    SUM(CASE WHEN fa.response_type IN ('ignore_repeat', 'not_processed_repeat') THEN fa.count ELSE 0 END) AS outcome_ignore_repeat,
    SUM(CASE WHEN fa.response_type = 'outcome_other' THEN fa.count ELSE 0 END) AS outcome_other,
    SUM(CASE WHEN fa.response_type = 'carried_forward' THEN fa.count ELSE 0 END) AS app_carried_forward
  FROM fact_application fa
  WHERE fa.applicant_type <> 'total'
  GROUP BY fa.report_id, fa.version_id
),
legal_pivot AS (
  SELECT
    flp.report_id,
    flp.version_id,
    SUM(CASE WHEN flp.case_type = 'review' AND flp.result_type = 'total' THEN flp.count ELSE 0 END) AS rev_total,
    SUM(CASE WHEN flp.case_type = 'review' AND flp.result_type = 'correct' THEN flp.count ELSE 0 END) AS rev_corrected,
    SUM(CASE WHEN flp.case_type IN ('litigation_direct', 'litigation_post_review') AND flp.result_type = 'total' THEN flp.count ELSE 0 END) AS lit_total,
    SUM(CASE WHEN flp.case_type IN ('litigation_direct', 'litigation_post_review') AND flp.result_type = 'correct' THEN flp.count ELSE 0 END) AS lit_corrected
  FROM fact_legal_proceeding flp
  GROUP BY flp.report_id, flp.version_id
)
SELECT
  CONCAT('report_', b.report_id) AS id,
  b.year,
  CASE
    WHEN b.level <= 2 THEN CONCAT('city_', b.region_id)
    ELSE CONCAT('district_', b.region_id)
  END AS org_id,
  b.org_name,
  CASE
    WHEN b.level <= 2 THEN 'city'
    ELSE 'district'
  END AS org_type,
  CASE
    WHEN b.parent_id IS NULL THEN NULL
    WHEN parent.level <= 2 THEN CONCAT('city_', b.parent_id)
    ELSE CONCAT('district_', b.parent_id)
  END AS parent_id,
  COALESCE(ad.reg_published, 0) AS reg_published,
  COALESCE(ad.reg_active, 0) AS reg_active,
  COALESCE(ad.reg_abolished, 0) AS reg_abolished,
  COALESCE(ad.doc_published, 0) AS doc_published,
  COALESCE(ad.doc_active, 0) AS doc_active,
  COALESCE(ad.doc_abolished, 0) AS doc_abolished,
  COALESCE(ad.action_licensing, 0) AS action_licensing,
  COALESCE(ad.action_punishment, 0) AS action_punishment,
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
  COALESCE(ap.outcome_not_open_danger, 0) AS outcome_not_open_danger,
  COALESCE(ap.outcome_not_open_process, 0) AS outcome_not_open_process,
  COALESCE(ap.outcome_not_open_internal, 0) AS outcome_not_open_internal,
  COALESCE(ap.outcome_not_open_third_party, 0) AS outcome_not_open_third_party,
  COALESCE(ap.outcome_not_open_admin_query, 0) AS outcome_not_open_admin_query,
  COALESCE(ap.outcome_ignore, 0) AS outcome_ignore,
  COALESCE(ap.outcome_ignore_repeat, 0) AS outcome_ignore_repeat,
  COALESCE(ap.outcome_other, 0) AS outcome_other,
  COALESCE(ap.app_carried_forward, 0) AS app_carried_forward,
  COALESCE(lp.rev_total, 0) AS rev_total,
  COALESCE(lp.rev_corrected, 0) AS rev_corrected,
  COALESCE(lp.lit_total, 0) AS lit_total,
  COALESCE(lp.lit_corrected, 0) AS lit_corrected
FROM base b
LEFT JOIN regions parent ON parent.id = b.parent_id
LEFT JOIN active_disclosure_pivot ad ON ad.report_id = b.report_id AND ad.version_id = b.version_id
LEFT JOIN application_pivot ap ON ap.report_id = b.report_id AND ap.version_id = b.version_id
LEFT JOIN legal_pivot lp ON lp.report_id = b.report_id AND lp.version_id = b.version_id
WITH NO DATA;

COMMIT;
