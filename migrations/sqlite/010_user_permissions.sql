-- Add permissions and data_scope to admin_users
ALTER TABLE admin_users ADD COLUMN permissions TEXT DEFAULT '{}';
ALTER TABLE admin_users ADD COLUMN data_scope TEXT DEFAULT '{}';
