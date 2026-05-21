ALTER TABLE report_consistency_items
  DROP CONSTRAINT IF EXISTS report_consistency_items_group_key_check;

ALTER TABLE report_consistency_items
  ADD CONSTRAINT report_consistency_items_group_key_check
  CHECK (group_key IN ('table2', 'table3', 'table4', 'text', 'visual', 'structure', 'quality', 'hierarchy'));
