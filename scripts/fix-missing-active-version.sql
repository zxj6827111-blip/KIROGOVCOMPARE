-- Fix reports with missing active_version_id when valid parsed_json exists.
-- Safe to run multiple times; only fills NULL active_version_id.
--
-- Usage (psql):
--   \i scripts/fix-missing-active-version.sql
--
-- Optional: set a larger/smaller threshold by changing MIN_JSON_LEN.

-- ================
-- 1) Pre-check
-- ================
SELECT COUNT(*) AS missing_active_version
FROM reports
WHERE active_version_id IS NULL;

-- Preview up to 50 candidates
WITH candidate AS (
  SELECT
    r.id AS report_id,
    rv.id AS version_id,
    length(rv.parsed_json::text) AS json_len,
    rv.created_at
  FROM reports r
  JOIN LATERAL (
    SELECT id, parsed_json, created_at
    FROM report_versions
    WHERE report_id = r.id
      AND parsed_json IS NOT NULL
      AND length(parsed_json::text) > 100
    ORDER BY created_at DESC
    LIMIT 1
  ) rv ON true
  WHERE r.active_version_id IS NULL
)
SELECT *
FROM candidate
ORDER BY created_at DESC
LIMIT 50;

-- =========================
-- 2) Update (core fix)
-- =========================
WITH candidate AS (
  SELECT
    r.id AS report_id,
    rv.id AS version_id
  FROM reports r
  JOIN LATERAL (
    SELECT id, created_at
    FROM report_versions
    WHERE report_id = r.id
      AND parsed_json IS NOT NULL
      AND length(parsed_json::text) > 100
    ORDER BY created_at DESC
    LIMIT 1
  ) rv ON true
  WHERE r.active_version_id IS NULL
)
UPDATE reports r
SET active_version_id = c.version_id,
    updated_at = NOW()
FROM candidate c
WHERE r.id = c.report_id;

-- =========================
-- 3) Sync is_active flags
-- =========================
-- Ensure exactly one active version matches reports.active_version_id.
-- This will set is_active=true for the active version and false for others.
UPDATE report_versions rv
SET is_active = (rv.id = r.active_version_id)
FROM reports r
WHERE rv.report_id = r.id
  AND r.active_version_id IS NOT NULL;

-- ================
-- 4) Post-check
-- ================
SELECT COUNT(*) AS missing_active_version_after
FROM reports
WHERE active_version_id IS NULL;

-- Count reports that still have multiple active versions (should be 0)
SELECT report_id, COUNT(*) AS active_count
FROM report_versions
WHERE is_active = true
GROUP BY report_id
HAVING COUNT(*) > 1
ORDER BY active_count DESC, report_id ASC
LIMIT 50;

-- Optional: enforce uniqueness at DB level (safe after sync)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM report_versions
    WHERE is_active = true
    GROUP BY report_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'Skip uq_report_versions_active creation: duplicates still exist.';
  ELSE
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_report_versions_active ON report_versions(report_id) WHERE is_active = true';
  END IF;
END$$;
