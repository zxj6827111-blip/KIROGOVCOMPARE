-- GovInsight VIEW Fix: Update parent_id format to match org_id
-- This migration updates the view to use 'city_X' format for parent_id 
-- instead of plain numeric IDs, enabling proper parent-child matching in frontend.

DROP VIEW IF EXISTS gov_open_annual_stats;

CREATE VIEW gov_open_annual_stats AS
SELECT
  'report_' || r.id AS id,
  r.year,
  -- org_id: 字符串格式 (兼容大屏需求)
  CASE
    WHEN reg.parent_id IS NULL THEN 'city_' || r.region_id
    ELSE 'district_' || r.region_id
  END AS org_id,
  reg.name AS org_name,
  CASE
    WHEN reg.parent_id IS NULL THEN 'city'
    ELSE 'district'
  END AS org_type,
  -- parent_id: 格式需要与 org_id 一致 (使用 city_X 格式)
  CASE
    WHEN reg.parent_id IS NULL THEN NULL
    ELSE 'city_' || reg.parent_id
  END AS parent_id,
  -- 规章/文件 (从 fact_active_disclosure 聚合)
  COALESCE((SELECT SUM(CASE WHEN fad.category = '规章' THEN fad.made_count ELSE 0 END) FROM fact_active_disclosure fad WHERE fad.report_id = r.id AND fad.version_id = r.active_version_id), 0) AS reg_published,
  COALESCE((SELECT SUM(CASE WHEN fad.category = '规章' THEN fad.valid_count ELSE 0 END) FROM fact_active_disclosure fad WHERE fad.report_id = r.id AND fad.version_id = r.active_version_id), 0) AS reg_active,
  COALESCE((SELECT SUM(CASE WHEN fad.category = '规范性文件' THEN fad.made_count ELSE 0 END) FROM fact_active_disclosure fad WHERE fad.report_id = r.id AND fad.version_id = r.active_version_id), 0) AS doc_published,
  COALESCE((SELECT SUM(CASE WHEN fad.category = '规范性文件' THEN fad.valid_count ELSE 0 END) FROM fact_active_disclosure fad WHERE fad.report_id = r.id AND fad.version_id = r.active_version_id), 0) AS doc_active,
  COALESCE((SELECT SUM(CASE WHEN fad.category = '行政许可' THEN COALESCE(fad.processed_count, 0) ELSE 0 END) FROM fact_active_disclosure fad WHERE fad.report_id = r.id AND fad.version_id = r.active_version_id), 0) AS action_licensing,
  COALESCE((SELECT SUM(CASE WHEN fad.category = '行政处罚' THEN COALESCE(fad.processed_count, 0) ELSE 0 END) FROM fact_active_disclosure fad WHERE fad.report_id = r.id AND fad.version_id = r.active_version_id), 0) AS action_punishment,
  -- 依申请公开 (从 fact_application 聚合)
  COALESCE((SELECT SUM(CASE WHEN fa.response_type = 'new_received' THEN fa.count ELSE 0 END) FROM fact_application fa WHERE fa.report_id = r.id AND fa.version_id = r.active_version_id), 0) AS app_new,
  COALESCE((SELECT SUM(CASE WHEN fa.response_type = 'carried_over' THEN fa.count ELSE 0 END) FROM fact_application fa WHERE fa.report_id = r.id AND fa.version_id = r.active_version_id), 0) AS app_carried_over,
  COALESCE((SELECT SUM(CASE WHEN fa.applicant_type = 'natural_person' THEN fa.count ELSE 0 END) FROM fact_application fa WHERE fa.report_id = r.id AND fa.version_id = r.active_version_id), 0) AS source_natural,
  COALESCE((SELECT SUM(CASE WHEN fa.response_type IN ('granted', 'public') THEN fa.count ELSE 0 END) FROM fact_application fa WHERE fa.report_id = r.id AND fa.version_id = r.active_version_id), 0) AS outcome_public,
  COALESCE((SELECT SUM(CASE WHEN fa.response_type IN ('partial_grant', 'partial') THEN fa.count ELSE 0 END) FROM fact_application fa WHERE fa.report_id = r.id AND fa.version_id = r.active_version_id), 0) AS outcome_partial,
  COALESCE((SELECT SUM(CASE WHEN fa.response_type IN ('unable_to_provide', 'unable') THEN fa.count ELSE 0 END) FROM fact_application fa WHERE fa.report_id = r.id AND fa.version_id = r.active_version_id), 0) AS outcome_unable,
  COALESCE((SELECT SUM(CASE WHEN fa.response_type IN ('denied', 'not_open') THEN fa.count ELSE 0 END) FROM fact_application fa WHERE fa.report_id = r.id AND fa.version_id = r.active_version_id), 0) AS outcome_not_open,
  COALESCE((SELECT SUM(CASE WHEN fa.response_type IN ('ignored', 'other') THEN fa.count ELSE 0 END) FROM fact_application fa WHERE fa.report_id = r.id AND fa.version_id = r.active_version_id), 0) AS outcome_ignore,
  COALESCE((SELECT SUM(CASE WHEN fa.response_type = 'carried_forward' THEN fa.count ELSE 0 END) FROM fact_application fa WHERE fa.report_id = r.id AND fa.version_id = r.active_version_id), 0) AS app_carried_forward,
  -- 复议诉讼 (从 fact_legal_proceeding 聚合)
  COALESCE((SELECT SUM(CASE WHEN flp.case_type = 'reconsideration' AND flp.result_type = 'total' THEN flp.count ELSE 0 END) FROM fact_legal_proceeding flp WHERE flp.report_id = r.id AND flp.version_id = r.active_version_id), 0) AS rev_total,
  COALESCE((SELECT SUM(CASE WHEN flp.case_type = 'reconsideration' AND flp.result_type = 'corrected' THEN flp.count ELSE 0 END) FROM fact_legal_proceeding flp WHERE flp.report_id = r.id AND flp.version_id = r.active_version_id), 0) AS rev_corrected,
  COALESCE((SELECT SUM(CASE WHEN flp.case_type = 'litigation' AND flp.result_type = 'total' THEN flp.count ELSE 0 END) FROM fact_legal_proceeding flp WHERE flp.report_id = r.id AND flp.version_id = r.active_version_id), 0) AS lit_total,
  COALESCE((SELECT SUM(CASE WHEN flp.case_type = 'litigation' AND flp.result_type = 'corrected' THEN flp.count ELSE 0 END) FROM fact_legal_proceeding flp WHERE flp.report_id = r.id AND flp.version_id = r.active_version_id), 0) AS lit_corrected
FROM reports r
LEFT JOIN regions reg ON reg.id = r.region_id
WHERE r.active_version_id IS NOT NULL;
