-- Add indexes for performance optimization
CREATE INDEX IF NOT EXISTS idx_fact_active_disclosure_rv ON fact_active_disclosure(report_id, version_id);
CREATE INDEX IF NOT EXISTS idx_fact_application_rv ON fact_application(report_id, version_id);
CREATE INDEX IF NOT EXISTS idx_fact_legal_proceeding_rv ON fact_legal_proceeding(report_id, version_id);
