import TaskService from './TaskService';

const COMPARE_PIPELINE_DISABLED_ERROR =
  'compare_pipeline_unavailable: PdfParseService/StructuringService pipeline has been retired';

export class CompareTaskProcessor {
  async processCompareTask(taskId: string): Promise<void> {
    const error = new Error(COMPARE_PIPELINE_DISABLED_ERROR);
    await TaskService.setTaskError(taskId, COMPARE_PIPELINE_DISABLED_ERROR);
    throw error;
  }
}

export default new CompareTaskProcessor();
