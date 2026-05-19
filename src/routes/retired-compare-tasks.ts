import { Router, Request, Response } from 'express';

const router = Router();

export const RETIRED_COMPARE_TASKS_RESPONSE = {
  error: 'legacy_compare_tasks_retired',
  message:
    'The legacy /api/v1/tasks/compare pipeline has been retired. Use the report-based /api/comparisons workflow instead.',
  replacement: '/api/comparisons',
};

function retiredCompareTasksHandler(_req: Request, res: Response): void {
  res.status(410).json(RETIRED_COMPARE_TASKS_RESPONSE);
}

router.all('/', retiredCompareTasksHandler);
router.all('/*', retiredCompareTasksHandler);

export default router;
