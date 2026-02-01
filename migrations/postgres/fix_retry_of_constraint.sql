-- 修复 compare_tasks 表中 retry_of 外键约束
-- 问题：当删除一个被其他任务引用的任务时（作为重试的原始任务），会因为外键约束而失败
-- 解决：将外键约束改为 ON DELETE SET NULL

-- 1. 删除旧的外键约束
ALTER TABLE compare_tasks 
DROP CONSTRAINT IF EXISTS compare_tasks_retry_of_fkey;

-- 2. 添加新的外键约束，带 ON DELETE SET NULL
ALTER TABLE compare_tasks 
ADD CONSTRAINT compare_tasks_retry_of_fkey 
FOREIGN KEY (retry_of) REFERENCES compare_tasks(task_id) ON DELETE SET NULL;
