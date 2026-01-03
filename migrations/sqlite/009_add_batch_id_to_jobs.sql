-- Add batch_id to jobs table for grouping batch uploads together
-- This allows the JobCenter to display each batch upload as a separate task group

ALTER TABLE jobs ADD COLUMN batch_id TEXT;

-- Create index for efficient batch_id queries
CREATE INDEX IF NOT EXISTS idx_jobs_batch_id ON jobs(batch_id);
