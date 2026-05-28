import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import pool from '../config/database-llm';
import { llmJobRunner } from '../services/LlmJobRunner';
import { startPdfExportWorker, stopPdfExportWorker } from '../services/PdfExportWorker';
import jobsRouter from '../routes/jobs';
import { DEFAULT_PDF_EXPORTS_DIR } from '../utils/pdfExportPath';

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.user = {
      id: 55,
      username: 'job-admin',
      permissions: { manage_jobs: true },
      dataScope: {},
    };
    next();
  },
  requirePermission: (permission: string) => (req: any, res: any, next: () => void) => {
    if (req.user?.permissions?.[permission] === true) {
      next();
      return;
    }
    res.status(403).json({ error: 'permission_denied', required: permission });
  },
}));

jest.mock('../utils/dataScope', () => ({
  getAllowedRegionIdsAsync: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/SourceFileGuardService', () => ({
  checkVersionSourceFileExists: jest.fn(),
}));

jest.mock('../config/database-llm', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

jest.mock('../services/report-export/BrowserRenderer', () => ({
  findFrontendUrl: jest.fn(),
  renderPdfBuffer: jest.fn(),
}));

jest.mock('../services/report-export/PrintPageAdapter', () => ({
  COMPARISON_LANDSCAPE_PRINT_CSS: '',
  createComparisonPrintPageAdapter: jest.fn(),
}));

const mockedQuery = pool.query as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/jobs', jobsRouter);
  return app;
}

function makeTempPdf(name: string): string {
  const filePath = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(filePath, Buffer.from('%PDF-1.4\nunsafe\n'));
  return filePath;
}

describe('security hardening worker recovery and file paths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stopPdfExportWorker();
  });

  afterEach(() => {
    stopPdfExportWorker();
  });

  it('keeps LlmJobRunner recovery scoped away from pdf_export jobs', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] })
      .mockResolvedValueOnce({ rows: [] });

    llmJobRunner.start();
    await Promise.resolve();
    llmJobRunner.stop();

    expect(mockedQuery).toHaveBeenNthCalledWith(
      1,
      "SELECT id FROM jobs WHERE status = 'running' AND kind != 'pdf_export'"
    );
    expect(String(mockedQuery.mock.calls[1][0])).toContain("WHERE status = 'running' AND kind != 'pdf_export'");
  });

  it('recovers only running pdf_export jobs when the PDF worker starts', async () => {
    mockedQuery.mockResolvedValue({ rows: [] });

    startPdfExportWorker();
    await Promise.resolve();

    expect(String(mockedQuery.mock.calls[0][0])).toContain("WHERE kind = 'pdf_export' AND status = 'running'");
  });

  it('does not delete a pdf_export file path outside the allowed export roots', async () => {
    const unsafePath = makeTempPdf('unsafe-job-delete');
    mockedQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('SELECT j.*, r.region_id')) {
        return {
          rows: [{
            id: 99,
            kind: 'pdf_export',
            file_path: unsafePath,
            region_id: 1,
          }],
        };
      }
      if (text.includes('DELETE FROM jobs')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    try {
      const response = await request(buildApp()).delete('/api/jobs/task/99');

      expect(response.status).toBe(200);
      expect(fs.existsSync(unsafePath)).toBe(true);
      expect(mockedQuery).toHaveBeenCalledWith('DELETE FROM jobs WHERE id = $1', [99]);
    } finally {
      fs.rmSync(unsafePath, { force: true });
    }
  });

  it('deletes a pdf_export file when the path is inside the export root', async () => {
    fs.mkdirSync(DEFAULT_PDF_EXPORTS_DIR, { recursive: true });
    const safePath = path.join(DEFAULT_PDF_EXPORTS_DIR, `safe-job-delete-${Date.now()}.pdf`);
    fs.writeFileSync(safePath, Buffer.from('%PDF-1.4\nsafe\n'));
    mockedQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('SELECT j.*, r.region_id')) {
        return {
          rows: [{
            id: 100,
            kind: 'pdf_export',
            file_path: safePath,
            region_id: 1,
          }],
        };
      }
      if (text.includes('DELETE FROM jobs')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const response = await request(buildApp()).delete('/api/jobs/task/100');

    expect(response.status).toBe(200);
    expect(fs.existsSync(safePath)).toBe(false);
  });
});
