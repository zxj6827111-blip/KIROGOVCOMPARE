import Queue from 'bull';
import redisClient from './redis';

// 比对任务队列
export const compareTaskQueue = new Queue('compare-tasks', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.REDIS_DB || '0'),
  },
});

// AI建议队列
export const aiSuggestionQueue = new Queue('ai-suggestions', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.REDIS_DB || '0'),
  },
});

// DOCX导出队列
export const docxExportQueue = new Queue('docx-exports', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.REDIS_DB || '0'),
  },
});

// 批量比对队列
export const batchJobQueue = new Queue('batch-jobs', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.REDIS_DB || '0'),
  },
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
