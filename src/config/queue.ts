import Queue from 'bull';
import redisClient from './redis';

// 解析 REDIS_URL 为 host/port/db（bull 需要对象配置）
const parseRedisUrl = () => {
  if (process.env.REDIS_URL) {
    try {
      const url = new URL(process.env.REDIS_URL);
      const host = url.hostname;
      const port = parseInt(url.port || '6379');
      const db = url.pathname ? parseInt(url.pathname.slice(1)) : 0;
      console.log(`[Queue] 从 REDIS_URL 解析: host=${host}, port=${port}, db=${db}`);
      return { host, port, db };
    } catch (error) {
      console.error('[Queue] 解析 REDIS_URL 失败:', error);
    }
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.REDIS_DB || '0'),
  };
};

const redisConfig = parseRedisUrl();

// 比对任务队列
export const compareTaskQueue = new Queue('compare-tasks', {
  redis: redisConfig,
});

// AI建议队列
export const aiSuggestionQueue = new Queue('ai-suggestions', {
  redis: redisConfig,
});

// DOCX导出队列
export const docxExportQueue = new Queue('docx-exports', {
  redis: redisConfig,
});

// 批量比对队列
export const batchJobQueue = new Queue('batch-jobs', {
  redis: redisConfig,
});

// 队列事件监听
compareTaskQueue.on('error', (error) => {
  console.error('Compare task queue error:', error);
});

aiSuggestionQueue.on('error', (error) => {
  console.error('AI suggestion queue error:', error);
});

docxExportQueue.on('error', (error) => {
  console.error('DOCX export queue error:', error);
});

batchJobQueue.on('error', (error) => {
  console.error('Batch job queue error:', error);
});

export default {
  compareTaskQueue,
  aiSuggestionQueue,
  docxExportQueue,
  batchJobQueue,
};
