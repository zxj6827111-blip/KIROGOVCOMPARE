-- 年报资产表
CREATE TABLE IF NOT EXISTS report_assets (
  asset_id VARCHAR(255) PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  file_hash VARCHAR(64) NOT NULL UNIQUE,
  file_size BIGINT NOT NULL,
  storage_path VARCHAR(512) NOT NULL,
  source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('upload', 'url')),
  source_url VARCHAR(512),
  year INTEGER,
  region VARCHAR(255),
  department VARCHAR(255),
  report_type VARCHAR(255),
  tags TEXT[],
  status VARCHAR(50) NOT NULL CHECK (status IN ('usable', 'unusable')),
  unusable_reason TEXT,
  version_group_id VARCHAR(255),
  revision INTEGER,
  supersedes_asset_id VARCHAR(255),
  parse_version VARCHAR(50),
  structured_data_path VARCHAR(512),
  owner_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255),
  visibility VARCHAR(50) NOT NULL CHECK (visibility IN ('private', 'org', 'public')),
  shared_to TEXT[],
  uploaded_by VARCHAR(255) NOT NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supersedes_asset_id) REFERENCES report_assets(asset_id)
);

CREATE INDEX idx_report_assets_file_hash ON report_assets(file_hash);
CREATE INDEX idx_report_assets_owner_id ON report_assets(owner_id);
CREATE INDEX idx_report_assets_year_region_dept ON report_assets(year, region, department);
CREATE INDEX idx_report_assets_version_group ON report_assets(version_group_id);

-- 比对任务表
CREATE TABLE IF NOT EXISTS compare_tasks (
  task_id VARCHAR(255) PRIMARY KEY,
  asset_id_a VARCHAR(255) NOT NULL,
  asset_id_b VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  stage VARCHAR(50) NOT NULL CHECK (stage IN ('ingesting', 'downloading', 'parsing', 'structuring', 'diffing', 'summarizing', 'exporting')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  message TEXT,
  warnings JSONB NOT NULL DEFAULT '[]',
  error_message TEXT,
  diff_result_path VARCHAR(512),
  summary JSONB,
  retry_of VARCHAR(255),
  created_by VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  FOREIGN KEY (asset_id_a) REFERENCES report_assets(asset_id),
  FOREIGN KEY (asset_id_b) REFERENCES report_assets(asset_id),
  FOREIGN KEY (retry_of) REFERENCES compare_tasks(task_id)
);

CREATE INDEX idx_compare_tasks_status ON compare_tasks(status);
CREATE INDEX idx_compare_tasks_created_by ON compare_tasks(created_by);
CREATE INDEX idx_compare_tasks_created_at ON compare_tasks(created_at);
CREATE INDEX idx_compare_tasks_retry_of ON compare_tasks(retry_of);

-- 比对结果表
CREATE TABLE IF NOT EXISTS diff_results (
  result_id VARCHAR(255) PRIMARY KEY,
  task_id VARCHAR(255) NOT NULL UNIQUE,
  diff_result JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES compare_tasks(task_id) ON DELETE CASCADE
);

CREATE INDEX idx_diff_results_task_id ON diff_results(task_id);

-- 导出任务表
CREATE TABLE IF NOT EXISTS export_jobs (
  export_id VARCHAR(255) PRIMARY KEY,
  task_id VARCHAR(255) NOT NULL,
  export_type VARCHAR(50) NOT NULL CHECK (export_type IN ('diff', 'diff_with_ai')),
  file_path VARCHAR(512) NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('succeeded', 'failed')),
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES compare_tasks(task_id) ON DELETE CASCADE
);

CREATE INDEX idx_export_jobs_task_id ON export_jobs(task_id);
CREATE INDEX idx_export_jobs_export_type ON export_jobs(task_id, export_type);

-- AI建议表
CREATE TABLE IF NOT EXISTS ai_suggestions (
  suggestion_id VARCHAR(255) PRIMARY KEY,
  compare_task_id VARCHAR(255) NOT NULL,
  ai_config_version INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  interpretation TEXT,
  suspicious_points JSONB,
  improvement_suggestions TEXT[],
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  FOREIGN KEY (compare_task_id) REFERENCES compare_tasks(task_id) ON DELETE CASCADE,
  UNIQUE(compare_task_id, ai_config_version)
);

CREATE INDEX idx_ai_suggestions_compare_task_id ON ai_suggestions(compare_task_id);
CREATE INDEX idx_ai_suggestions_status ON ai_suggestions(status);

-- 批量比对任务表
CREATE TABLE IF NOT EXISTS batch_jobs (
  batch_id VARCHAR(255) PRIMARY KEY,
  rule VARCHAR(50) NOT NULL,
  region VARCHAR(255),
  department VARCHAR(255),
  pairs JSONB NOT NULL,
  conflicts JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(50) NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  task_ids TEXT[] NOT NULL DEFAULT '{}',
  task_results JSONB,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX idx_batch_jobs_status ON batch_jobs(status);
CREATE INDEX idx_batch_jobs_created_by ON batch_jobs(created_by);
CREATE INDEX idx_batch_jobs_created_at ON batch_jobs(created_at);

-- 解析缓存表
CREATE TABLE IF NOT EXISTS parse_cache (
  cache_id VARCHAR(255) PRIMARY KEY,
  asset_id VARCHAR(255) NOT NULL,
  parse_version VARCHAR(50) NOT NULL,
  structured_data_path VARCHAR(512) NOT NULL,
  cache_size BIGINT,
  extracted_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES report_assets(asset_id) ON DELETE CASCADE,
  UNIQUE(asset_id, parse_version)
);

CREATE INDEX idx_parse_cache_asset_id ON parse_cache(asset_id);
CREATE INDEX idx_parse_cache_asset_parse_version ON parse_cache(asset_id, parse_version);
