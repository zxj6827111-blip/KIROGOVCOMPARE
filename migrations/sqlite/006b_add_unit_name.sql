-- Ensure reports.unit_name exists before 007_support_multiple_units.sql
ALTER TABLE reports ADD COLUMN unit_name TEXT NOT NULL DEFAULT '';
