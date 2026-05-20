import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import pool from '../config/database-llm';
import pdfJobsRouter from '../routes/pdf-jobs';

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.user = {
      id: 1,
      username: 'pdf-regression-user',
      permissions: { view_reports: true, manage_jobs: true },
      dataScope: {},
    };
    next();
  },
}));

jest.mock('../utils/dataScope', () => ({
  getAllowedRegionIdsAsync: jest.fn().mockResolvedValue(null),
}));

jest.mock('../config/database-llm', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

const mockedQuery = pool.query as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/pdf-jobs', pdfJobsRouter);
  return app;
}

function binaryParser(res: any, callback: (error: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

function makeTempPdf(name: string): string {
  const filePath = path.join(
    os.tmpdir(),
    `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`
  );
  fs.writeFileSync(filePath, Buffer.from('%PDF-1.4\n% pdf jobs regression\n'));
  return filePath;
}

function mockCreateJobQueries() {
  mockedQuery.mockImplementation(async (sql: unknown) => {
    const text = String(sql);

    if (text.includes('SELECT c.id, c.year_a, c.year_b')) {
      return {
        rows: [
          {
            id: 4670,
            year_a: 2024,
            year_b: 2025,
            unit_name: '淮安市',
            region_name: '淮安市',
            left_report_id: 9001,
          },
        ],
      };
    }

    if (text.includes('INSERT INTO jobs')) {
      return { rows: [{ id: 18395 }] };
    }

    return { rows: [] };
  });
}

function mockDownloadJob(row: Record<string, unknown>) {
  mockedQuery.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    if (text.includes('SELECT') && text.includes('FROM jobs j')) {
      return { rows: [row] };
    }
    return { rows: [] };
  });
}

describe('PDF jobs regression baseline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a recommended comparison PDF job', async () => {
    mockCreateJobQueries();

    const response = await request(buildApp())
      .post('/api/pdf-jobs')
      .send({ comparison_id: 4670 });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      job_id: 18395,
      file_name: '淮安市_2024-2025年报比对.pdf',
    });
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO jobs'),
      expect.arrayContaining([9001, 4670])
    );
  });

  it('downloads a completed PDF job when the file exists', async () => {
    const pdfPath = makeTempPdf('pdf-jobs-done');
    mockDownloadJob({
      id: 1,
      status: 'done',
      file_path: pdfPath,
      file_name: 'done.pdf',
      comparison_id: 4670,
      export_title: 'Done PDF',
    });

    try {
      const response = await request(buildApp()).get('/api/pdf-jobs/1/download');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['content-disposition']).toContain('done.pdf');
      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(pdfPath, { force: true });
    }
  });

  it('does not treat failed jobs as downloadable PDFs', async () => {
    mockDownloadJob({
      id: 2,
      status: 'failed',
      file_path: null,
      file_name: 'failed.pdf',
      comparison_id: 4670,
      export_title: 'Failed PDF',
    });

    const response = await request(buildApp()).get('/api/pdf-jobs/2/download');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: 'PDF not ready',
      status: 'failed',
    });
  });

  it('returns an explicit expired-file response when the stored PDF is missing', async () => {
    const missingPath = path.join(os.tmpdir(), `missing-pdf-${Date.now()}.pdf`);
    mockDownloadJob({
      id: 3,
      status: 'done',
      file_path: missingPath,
      file_name: 'missing.pdf',
      comparison_id: 1143,
      export_title: 'Missing PDF',
    });

    const response = await request(buildApp()).get('/api/pdf-jobs/3/download');

    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({
      error: 'File expired',
      comparison_id: 1143,
      needs_regeneration: true,
    });
  });

  it('packages only completed jobs with existing files in batch download', async () => {
    const firstPdf = makeTempPdf('pdf-batch-first');
    const secondPdf = makeTempPdf('pdf-batch-second');
    const missingPdf = path.join(os.tmpdir(), `pdf-batch-missing-${Date.now()}.pdf`);

    mockedQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('SELECT j.id, j.file_path, j.file_name')) {
        return {
          rows: [
            { id: 1, file_path: firstPdf, file_name: 'first.pdf', export_title: 'First', status: 'done' },
            { id: 2, file_path: secondPdf, file_name: 'second.pdf', export_title: 'Second', status: 'done' },
            { id: 3, file_path: missingPdf, file_name: 'missing.pdf', export_title: 'Missing', status: 'done' },
          ],
        };
      }
      return { rows: [] };
    });

    try {
      const response = await request(buildApp())
        .post('/api/pdf-jobs/batch-download')
        .send({ job_ids: [1, 2, 3] })
        .buffer(true)
        .parse(binaryParser);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/zip');
      expect(response.body.length).toBeGreaterThan(100);
      expect(response.body.includes(Buffer.from('first.pdf'))).toBe(true);
      expect(response.body.includes(Buffer.from('second.pdf'))).toBe(true);
      expect(response.body.includes(Buffer.from('missing.pdf'))).toBe(false);
    } finally {
      fs.rmSync(firstPdf, { force: true });
      fs.rmSync(secondPdf, { force: true });
    }
  });
});
