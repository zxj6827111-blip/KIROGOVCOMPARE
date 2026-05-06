import { Job, Queue, Worker } from 'bullmq';

type QueueHandler<T = any> = (job: { id: string; data: T }) => Promise<unknown> | unknown;
type QueueEventHandler = (error: Error) => void;

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  db: parseInt(process.env.REDIS_DB || '0', 10),
  ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
};

class BackgroundQueue<T = any> {
  private readonly queue: Queue<T, unknown, string>;
  private worker: Worker<T, unknown, string> | null = null;
  private readonly errorHandlers: QueueEventHandler[] = [];

  constructor(private readonly name: string) {
    this.queue = new Queue<T, unknown, string>(name, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    });
    this.queue.on('error', this.emitError);
  }

  process(handler: QueueHandler<T>): void {
    if (this.worker) {
      void this.worker.close().catch(this.emitError);
    }

    this.worker = new Worker<T, unknown, string>(
      this.name,
      async (job: Job<T>) => handler({ id: String(job.id || ''), data: job.data }),
      { connection }
    );
    this.worker.on('error', this.emitError);
    this.worker.on('failed', (_job, error) => this.emitError(error));
  }

  on(event: 'error', handler: QueueEventHandler): void {
    if (event === 'error') {
      this.errorHandlers.push(handler);
    }
  }

  async add(data: T): Promise<{ id: string; data: T }> {
    const job = await this.queue.add(this.name as any, data as any);
    return { id: String(job.id || ''), data };
  }

  private emitError = (error: Error): void => {
    for (const handler of this.errorHandlers) {
      handler(error);
    }
  };
}

// 比对任务队列
export const compareTaskQueue = new BackgroundQueue('compare-tasks');

// AI建议队列
export const aiSuggestionQueue = new BackgroundQueue('ai-suggestions');

// DOCX导出队列
export const docxExportQueue = new BackgroundQueue('docx-exports');

// 批量比对队列
export const batchJobQueue = new BackgroundQueue('batch-jobs');

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
