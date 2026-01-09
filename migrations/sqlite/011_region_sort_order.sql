-- Add sort_order column to regions table for custom ordering
-- Default value is the id to maintain current order

ALTER TABLE regions ADD COLUMN sort_order INTEGER;

-- Initialize sort_order with id for existing records
UPDATE regions SET sort_order = id WHERE sort_order IS NULL;
