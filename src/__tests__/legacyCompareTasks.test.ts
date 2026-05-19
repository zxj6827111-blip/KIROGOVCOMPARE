import express from 'express';
import request from 'supertest';
import tasksRouter from '../routes/tasks';

describe('Legacy compare task routes', () => {
  it('returns 410 for retired task compare endpoints', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/tasks', tasksRouter);

    const response = await request(app)
      .post('/api/v1/tasks/compare/upload')
      .send({});

    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({
      error: 'legacy_compare_tasks_retired',
      replacement: '/api/comparisons',
    });
  });
});
