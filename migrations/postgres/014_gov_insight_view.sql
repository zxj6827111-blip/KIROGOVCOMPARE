-- GovInsight VIEW: gov_open_annual_stats
-- 政务公开智慧治理大屏数据聚合视图
-- PIVOT fact_active_disclosure, fact_application, fact_legal_proceeding into wide table format

-- Drop view if exists for idempotency
DROP VIEW IF EXISTS gov_open_annual_stats;

CREATE VIEW gov_open_annual_stats AS
WITH RECURSIVE
-- 基础维度: 从 reports + regions 获取单位信息
-- 基础维度: 从 reports + regions 获取单位信息
-- 改为以 regions 为主表，确保所有行政区划都能显示 (即使没有报告)
-- 彻底解决 "两张皮" 问题中的层级缺失
base AS (
  SELECT
    r.id AS report_id,
    reg.id AS region_id,
    reg.name AS org_name,
    reg.level,
    reg.parent_id,
    -- Join parent to get parent level for ID generation prefix
    parent.level AS parent_level, 
    r.year,
    r.active_version_id AS version_id
  FROM regions reg
  LEFT JOIN regions parent ON parent.id = reg.parent_id
  LEFT JOIN reports r ON r.region_id = reg.id AND r.active_version_id IS NOT NULL
),

-- 主动公开 (规章/规范性文件/行政许可/行政处罚)
active_disclosure_pivot AS (
  SELECT
    fad.report_id,
    fad.version_id,
    -- 规章: 制发数 / 现行有效数
    SUM(CASE WHEN fad.category = '规章' THEN fad.made_count ELSE 0 END) AS reg_published,
    SUM(CASE WHEN fad.category = '规章' THEN fad.valid_count ELSE 0 END) AS reg_active,
    -- 规范性文件: 制发数 / 现行有效数
    SUM(CASE WHEN fad.category = '规范性文件' THEN fad.made_count ELSE 0 END) AS doc_published,
    SUM(CASE WHEN fad.category = '规范性文件' THEN fad.valid_count ELSE 0 END) AS doc_active,
    -- 行政许可: processed_count 作为处理决定数
    SUM(CASE WHEN fad.category = '行政许可' THEN COALESCE(fad.processed_count, 0) ELSE 0 END) AS action_licensing,
    -- 行政处罚: processed_count 作为处理决定数
    SUM(CASE WHEN fad.category = '行政处罚' THEN COALESCE(fad.processed_count, 0) ELSE 0 END) AS action_punishment
  FROM fact_active_disclosure fad
  GROUP BY fad.report_id, fad.version_id
),

-- 依申请公开
application_pivot AS (
  SELECT
    fa.report_id,
    fa.version_id,
    -- 新收总量
    SUM(CASE WHEN fa.response_type = 'new_received' THEN fa.count ELSE 0 END) AS app_new,
    -- 上年结转
    SUM(CASE WHEN fa.response_type = 'carried_over' THEN fa.count ELSE 0 END) AS app_carried_over,
    -- 来源: 自然人
    SUM(CASE WHEN fa.applicant_type = 'natural_person' THEN fa.count ELSE 0 END) AS source_natural,
    -- 结果: 予以公开
    SUM(CASE WHEN fa.response_type = 'granted' OR fa.response_type = 'public' THEN fa.count ELSE 0 END) AS outcome_public,
    -- 结果: 部分公开
    SUM(CASE WHEN fa.response_type = 'partial_grant' OR fa.response_type = 'partial' THEN fa.count ELSE 0 END) AS outcome_partial,
    -- 结果: 无法提供
    SUM(CASE WHEN fa.response_type = 'unable_to_provide' OR fa.response_type = 'unable' THEN fa.count ELSE 0 END) AS outcome_unable,
    -- 结果: 不予公开
    SUM(CASE WHEN fa.response_type = 'denied' OR fa.response_type = 'not_open' THEN fa.count ELSE 0 END) AS outcome_not_open,
    -- 结果: 不予处理/其他
    SUM(CASE WHEN fa.response_type = 'ignored' OR fa.response_type = 'other' THEN fa.count ELSE 0 END) AS outcome_ignore,
    -- 结转下年度
    SUM(CASE WHEN fa.response_type = 'carried_forward' THEN fa.count ELSE 0 END) AS app_carried_forward
  FROM fact_application fa
  GROUP BY fa.report_id, fa.version_id
),

-- 复议诉讼
legal_pivot AS (
  SELECT
    flp.report_id,
    flp.version_id,
    -- 复议总数
    SUM(CASE WHEN flp.case_type = 'reconsideration' AND flp.result_type = 'total' THEN flp.count ELSE 0 END) AS rev_total,
    -- 复议纠错
    SUM(CASE WHEN flp.case_type = 'reconsideration' AND flp.result_type = 'corrected' THEN flp.count ELSE 0 END) AS rev_corrected,
    -- 诉讼总数
    SUM(CASE WHEN flp.case_type = 'litigation' AND flp.result_type = 'total' THEN flp.count ELSE 0 END) AS lit_total,
    -- 诉讼败诉/纠错
    SUM(CASE WHEN flp.case_type = 'litigation' AND flp.result_type = 'corrected' THEN flp.count ELSE 0 END) AS lit_corrected
  FROM fact_legal_proceeding flp
  GROUP BY flp.report_id, flp.version_id
)

SELECT
  -- 生成 UUID 格式 ID (使用 report_id + year 组合)
  CONCAT('report_', b.report_id) AS id,
  b.year,
  -- org_id: Level 1/2 -> city_, Others -> district_
  CASE
    WHEN b.level <= 2 THEN CONCAT('city_', b.region_id)
    ELSE CONCAT('district_', b.region_id)
  END AS org_id,
  b.org_name,
  -- org_type
  CASE
    WHEN b.level <= 2 THEN 'city'
    ELSE 'district'
  END AS org_type,

  -- parent_id: Dynamic based on parent's level
  CASE
    WHEN b.parent_id IS NULL THEN NULL
    WHEN parent.level <= 2 THEN CONCAT('city_', b.parent_id)
    ELSE CONCAT('district_', b.parent_id)
  END AS parent_id,
  -- 规章/文件
  COALESCE(ad.reg_published, 0) AS reg_published,
  COALESCE(ad.reg_active, 0) AS reg_active,
  COALESCE(ad.doc_published, 0) AS doc_published,
  COALESCE(ad.doc_active, 0) AS doc_active,
  COALESCE(ad.action_licensing, 0) AS action_licensing,
  COALESCE(ad.action_punishment, 0) AS action_punishment,
  -- 依申请公开
  COALESCE(ap.app_new, 0) AS app_new,
  COALESCE(ap.app_carried_over, 0) AS app_carried_over,
  COALESCE(ap.source_natural, 0) AS source_natural,
  COALESCE(ap.outcome_public, 0) AS outcome_public,
  COALESCE(ap.outcome_partial, 0) AS outcome_partial,
  COALESCE(ap.outcome_unable, 0) AS outcome_unable,
  COALESCE(ap.outcome_not_open, 0) AS outcome_not_open,
  COALESCE(ap.outcome_ignore, 0) AS outcome_ignore,
  COALESCE(ap.app_carried_forward, 0) AS app_carried_forward,
  -- 复议诉讼
  COALESCE(lp.rev_total, 0) AS rev_total,
  COALESCE(lp.rev_corrected, 0) AS rev_corrected,
  COALESCE(lp.lit_total, 0) AS lit_total,
  COALESCE(lp.lit_corrected, 0) AS lit_corrected
FROM base b
LEFT JOIN regions parent ON parent.id = b.parent_id -- Join parent for level info
LEFT JOIN active_disclosure_pivot ad ON ad.report_id = b.report_id AND ad.version_id = b.version_id
LEFT JOIN application_pivot ap ON ap.report_id = b.report_id AND ap.version_id = b.version_id
LEFT JOIN legal_pivot lp ON lp.report_id = b.report_id AND lp.version_id = b.version_id;

-- Add comment for documentation
COMMENT ON VIEW gov_open_annual_stats IS '政务公开智慧治理大屏数据聚合视图 - 按年度和单位汇总主动公开、依申请公开、复议诉讼等核心指标';
