-- ============================================================================
-- 只读统计：评估 PDF 确定性解析能否替代大模型解析
-- 不修改任何数据；输出统一为 (section, metric, value) 三列，便于整块贴回。
-- 用法： psql "$DSN" -f scripts/parse-corpus-stats.sql
--   或： docker compose exec -T postgres psql -U postgres -d <库名> -f - < scripts/parse-corpus-stats.sql
-- ============================================================================

SET default_transaction_read_only = on;
SET statement_timeout = '180s';
\timing off
\pset footer off

-- ---------- S1 语料体量 ----------
SELECT 'S1' AS section, 'versions_total' AS metric, count(*)::text AS value FROM report_versions
UNION ALL SELECT 'S1', 'versions_is_active',   count(*)::text FROM report_versions WHERE is_active
UNION ALL SELECT 'S1', 'file_hash_distinct',   count(DISTINCT file_hash)::text FROM report_versions
UNION ALL SELECT 'S1', 'parse_runs_total',     count(*)::text FROM parse_runs
UNION ALL SELECT 'S1', 'versions_with_current_run', count(DISTINCT report_version_id)::text FROM parse_runs WHERE is_current
UNION ALL SELECT 'S1', 'versions_with_raw_text',    count(*)::text FROM report_versions WHERE raw_text IS NOT NULL

-- ---------- S2 解析结果状态分布 ----------
UNION ALL SELECT 'S2', 'parse_run_status=' || status, count(*)::text FROM parse_runs GROUP BY status
UNION ALL SELECT 'S2', 'parse_run_err=' || coalesce(error_code, 'NULL'), count(*)::text FROM parse_runs WHERE status IN ('failed','gate_failed','finalize_failed') GROUP BY 2

-- ---------- S3 来源门禁分布 ----------
UNION ALL SELECT 'S3', 'source_gate=' || status, count(*)::text FROM source_gate_results GROUP BY status
UNION ALL SELECT 'S3', 'gate_uncertain_sum',  coalesce(sum(uncertain_count),0)::text FROM source_gate_results
UNION ALL SELECT 'S3', 'gate_warning_sum',    coalesce(sum(warning_count),0)::text   FROM source_gate_results
UNION ALL SELECT 'S3', 'gate_blocker_sum',    coalesce(sum(blocker_count),0)::text   FROM source_gate_results

-- ---------- S4 一致性校验与人工仲裁 ----------
UNION ALL SELECT 'S4', 'consistency_runs',            count(*)::text FROM report_consistency_runs
UNION ALL SELECT 'S4', 'consistency_versions_covered', count(DISTINCT report_version_id)::text FROM report_consistency_runs
UNION ALL SELECT 'S4', 'item_' || group_key || '_' || auto_status, count(*)::text FROM report_consistency_items GROUP BY 2
UNION ALL SELECT 'S4', 'human_status=' || human_status, count(*)::text FROM report_consistency_items GROUP BY human_status

-- ---------- S5 文字层覆盖率（决定规则法可行性上限）----------
UNION ALL SELECT 'S5', 'rawtext_len_p05',  percentile_cont(0.05) WITHIN GROUP (ORDER BY length(raw_text))::bigint::text FROM report_versions WHERE raw_text IS NOT NULL
UNION ALL SELECT 'S5', 'rawtext_len_p25',  percentile_cont(0.25) WITHIN GROUP (ORDER BY length(raw_text))::bigint::text FROM report_versions WHERE raw_text IS NOT NULL
UNION ALL SELECT 'S5', 'rawtext_len_p50',  percentile_cont(0.50) WITHIN GROUP (ORDER BY length(raw_text))::bigint::text FROM report_versions WHERE raw_text IS NOT NULL
UNION ALL SELECT 'S5', 'rawtext_len_p95',  percentile_cont(0.95) WITHIN GROUP (ORDER BY length(raw_text))::bigint::text FROM report_versions WHERE raw_text IS NOT NULL
UNION ALL SELECT 'S5', 'rawtext_lt_1500_chars_suspect_scanned', count(*)::text FROM report_versions WHERE length(coalesce(raw_text,'')) < 1500
UNION ALL SELECT 'S5', 'rawtext_no_pipe_char_at_all',           count(*)::text FROM report_versions WHERE raw_text IS NOT NULL AND position('|' IN raw_text) = 0
UNION ALL SELECT 'S5', 'pipe_count_p05', percentile_cont(0.05) WITHIN GROUP (ORDER BY length(raw_text) - length(replace(left(raw_text, 300000), '|', '')))::bigint::text FROM report_versions WHERE raw_text IS NOT NULL
UNION ALL SELECT 'S5', 'pipe_count_p25', percentile_cont(0.25) WITHIN GROUP (ORDER BY length(raw_text) - length(replace(left(raw_text, 300000), '|', '')))::bigint::text FROM report_versions WHERE raw_text IS NOT NULL
UNION ALL SELECT 'S5', 'pipe_count_p50', percentile_cont(0.50) WITHIN GROUP (ORDER BY length(raw_text) - length(replace(left(raw_text, 300000), '|', '')))::bigint::text FROM report_versions WHERE raw_text IS NOT NULL

-- ---------- S6 table_3 实际数据形态与三态语义难度 ----------
UNION ALL SELECT 'S6', 'versions_with_table3_section', count(*)::text FROM report_versions rv WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(rv.parsed_json->'sections') s WHERE s->>'type' = 'table_3')
UNION ALL SELECT 'S6', 'cells_table3_total',   count(*)::text FROM cells WHERE table_id = 'table_3'
UNION ALL SELECT 'S6', 'cells_table3_versions', count(DISTINCT version_id)::text FROM cells WHERE table_id = 'table_3'
UNION ALL SELECT 'S6', 'cells_t3_semantic_' || value_semantic, count(*)::text FROM cells WHERE table_id = 'table_3' GROUP BY value_semantic
UNION ALL SELECT 'S6', 'cells_all_semantic_' || value_semantic, count(*)::text FROM cells GROUP BY value_semantic

-- ---------- S7 模型兜底与人工修正的真实触发量 ----------
UNION ALL SELECT 'S7', 'visual_reviews_total', count(*)::text FROM table_visual_reviews
UNION ALL SELECT 'S7', 'visual_review_status=' || status, count(*)::text FROM table_visual_reviews GROUP BY status
UNION ALL SELECT 'S7', 'visual_review_trigger=' || coalesce(left(trigger_reason, 60), 'NULL'), count(*)::text FROM table_visual_reviews GROUP BY 2
UNION ALL SELECT 'S7', 'ocr_corrections_total', count(*)::text FROM ocr_corrections
UNION ALL SELECT 'S7', 'ocr_correction_status=' || status, count(*)::text FROM ocr_corrections GROUP BY status

-- ---------- S8 证据锚定完整度（能否高亮回 PDF 原位）----------
UNION ALL SELECT 'S8', 'cells_with_page_number', count(*) FILTER (WHERE page_number IS NOT NULL)::text || ' / ' || count(*)::text FROM cells
UNION ALL SELECT 'S8', 'cells_with_bbox',        count(*) FILTER (WHERE bbox_json    IS NOT NULL)::text || ' / ' || count(*)::text FROM cells
UNION ALL SELECT 'S8', 'cells_with_confidence',  count(*) FILTER (WHERE confidence  IS NOT NULL)::text || ' / ' || count(*)::text FROM cells

-- ---------- S9 历史配置是否齐一（决定标注集能不能当基线）----------
UNION ALL SELECT 'S9', 'distinct_prompt_version',  count(DISTINCT prompt_version)::text  FROM parse_runs
UNION ALL SELECT 'S9', 'distinct_parser_version',  count(DISTINCT parser_version)::text  FROM parse_runs
UNION ALL SELECT 'S9', 'distinct_extractor_ver',   count(DISTINCT source_extractor_version)::text FROM parse_runs
UNION ALL SELECT 'S9', 'distinct_fingerprint',     count(DISTINCT fingerprint)::text     FROM parse_runs
UNION ALL SELECT 'S9', 'prompt_version=' || prompt_version, count(*)::text FROM parse_runs GROUP BY prompt_version
UNION ALL SELECT 'S9', 'provider=' || provider || '/' || model, count(*)::text FROM parse_runs GROUP BY 2
ORDER BY section, metric;
