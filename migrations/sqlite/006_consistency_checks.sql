-- 一致性勾稽校验功能表结构

-- 校验运行记录表
CREATE TABLE IF NOT EXISTS report_consistency_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_version_id INTEGER NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed')),
  engine_version TEXT NOT NULL DEFAULT 'v1',
  summary_json TEXT,  -- JSON: {fail, uncertain, pending, confirmed, dismissed}
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_consistency_runs_version 
  ON report_consistency_runs(report_version_id);

CREATE INDEX IF NOT EXISTS idx_consistency_runs_status 
  ON report_consistency_runs(status);

-- 校验问题项表
CREATE TABLE IF NOT EXISTS report_consistency_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES report_consistency_runs(id) ON DELETE CASCADE,
  report_version_id INTEGER NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  
  -- 分组和标识
  group_key TEXT NOT NULL CHECK(group_key IN ('table2', 'table3', 'table4', 'text')),
  check_key TEXT NOT NULL,  -- 稳定标识: t3_identity_balance, t4_sum_total 等
  fingerprint TEXT NOT NULL,  -- sha256(groupKey:checkKey:expr).substring(0, 16)
  
  -- 可读信息
  title TEXT NOT NULL,  -- 如: "表三：本年新收+上年结转=办理结果总计+结转下年度继续办理（总计列）"
  expr TEXT NOT NULL,  -- 公式字符串: "newReceived + carriedOver = totalProcessed + carriedForward"
  
  -- 计算结果
  left_value REAL,
  right_value REAL,
  delta REAL,
  tolerance REAL NOT NULL DEFAULT 0,
  auto_status TEXT NOT NULL CHECK(auto_status IN ('PASS', 'FAIL', 'UNCERTAIN', 'NOT_ASSESSABLE')),
  
  -- 证据
  evidence_json TEXT NOT NULL,  -- JSON: {paths: [...], values: {...}, textMatches: [...]}
  
  -- 人工复核
  human_status TEXT NOT NULL DEFAULT 'pending' CHECK(human_status IN ('pending', 'confirmed', 'dismissed')),
  human_comment TEXT,
  
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  -- 唯一约束：同一版本 + 同一 fingerprint 只能有一条记录
  UNIQUE(report_version_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_consistency_items_run 
  ON report_consistency_items(run_id);

CREATE INDEX IF NOT EXISTS idx_consistency_items_version 
  ON report_consistency_items(report_version_id);

CREATE INDEX IF NOT EXISTS idx_consistency_items_group 
  ON report_consistency_items(group_key);

CREATE INDEX IF NOT EXISTS idx_consistency_items_status 
  ON report_consistency_items(auto_status, human_status);

CREATE INDEX IF NOT EXISTS idx_consistency_items_fingerprint 
  ON report_consistency_items(fingerprint);
