-- Ensure comparisons has Phase 1 columns used by compare flow
ALTER TABLE comparisons ADD COLUMN similarity REAL;
ALTER TABLE comparisons ADD COLUMN check_status TEXT;
