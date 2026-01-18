-- Add active_version_id column if missing
ALTER TABLE reports ADD COLUMN IF NOT EXISTS active_version_id BIGINT;

-- Also add sort_order to regions if missing
ALTER TABLE regions ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Update active_version_id based on is_active flag in report_versions
UPDATE reports r 
SET active_version_id = (
    SELECT rv.id 
    FROM report_versions rv 
    WHERE rv.report_id = r.id 
    AND rv.is_active = true 
    ORDER BY rv.id DESC 
    LIMIT 1
)
WHERE r.active_version_id IS NULL;

-- Verify the update
SELECT COUNT(*) AS reports_with_active_version 
FROM reports 
WHERE active_version_id IS NOT NULL;
