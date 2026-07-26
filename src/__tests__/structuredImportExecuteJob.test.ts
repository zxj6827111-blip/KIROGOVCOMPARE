/**
 * executeImportJob: no LLM; enqueues materialize; re-verifies hashes.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

jest.mock('../config/database-llm', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../services/ParseRunService', () => ({
  buildParseConfigSnapshot: jest.fn((x) => x),
  parseRunService: {
    getCurrentParsedResult: jest.fn(),
    createParseRun: jest.fn(),
    markRunning: jest.fn(),
    finalizeParseRun: jest.fn(),
  },
}));

jest.mock('../services/LlmProviderFactory', () => ({
  createLlmProvider: jest.fn(() => {
    throw new Error('LLM factory must not be called for structured_import');
  }),
}));

import pool from '../config/database-llm';
import { parseRunService } from '../services/ParseRunService';
import { createLlmProvider } from '../services/LlmProviderFactory';
import { StructuredImportService } from '../services/structured-import/StructuredImportService';

const mockedQuery = pool.query as jest.Mock;

function writeMinimalPackage(dir: string) {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const md = '# hello package\n';
  const pdfHash = crypto.createHash('sha256').update(pdf).digest('hex');
  const mdHash = crypto.createHash('sha256').update(md).digest('hex');
  const sourceJson = {
    schema_version: '1.0',
    package_version: '1.0',
    generator: { name: 't', version: '0.0.1' },
    source: {
      pdf_filename: 'source.pdf',
      markdown_filename: 'source.md',
      pdf_sha256: pdfHash,
      markdown_sha256: mdHash,
      organization_name: '测试',
      report_year: 2024,
    },
    parsed_json: {
      sections: [
        {
          type: 'table_2',
          activeDisclosureData: {
            regulations: { made: 0, valid: 1, repealed: 0 },
            normativeDocuments: { made: 1, valid: null, repealed: 0 },
            licensing: { processed: 0 },
            punishment: { processed: 0 },
            coercion: { processed: 0 },
            fees: { amount: 0 },
          },
        },
      ],
    },
  };
  fs.writeFileSync(path.join(dir, 'package.kirogov.zip'), Buffer.from('PK\x03\x04fakezip'));
  fs.writeFileSync(path.join(dir, 'source.pdf'), pdf);
  fs.writeFileSync(path.join(dir, 'source.md'), md);
  fs.writeFileSync(path.join(dir, 'source.json'), JSON.stringify(sourceJson));
  return {
    packageHash: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'package.kirogov.zip'))).digest('hex'),
    pdfHash,
    mdHash,
    jsonHash: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'source.json'))).digest('hex'),
  };
}

describe('StructuredImportService.executeImportJob', () => {
  let tmp: string;
  let hashes: ReturnType<typeof writeMinimalPackage>;
  const service = new StructuredImportService();
  const insertedJobs: any[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    insertedJobs.length = 0;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-exec-'));
    hashes = writeMinimalPackage(tmp);
    mockedQuery.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('FROM report_versions rv') && sql.includes('report_version_artifacts')) {
        return {
          rows: [
            {
              id: 9,
              report_id: 3,
              package_sha256: hashes.packageHash,
              ingestion_mode: 'structured_import',
              parsed_json: {},
              package_path: path.join(tmp, 'package.kirogov.zip'),
              package_sha256_artifact: hashes.packageHash,
              pdf_path: path.join(tmp, 'source.pdf'),
              pdf_sha256: hashes.pdfHash,
              md_path: path.join(tmp, 'source.md'),
              md_sha256: hashes.mdHash,
              json_path: path.join(tmp, 'source.json'),
              json_sha256: hashes.jsonHash,
            },
          ],
        };
      }
      if (sql.includes("kind = 'materialize'") && sql.includes('SELECT id FROM jobs')) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO jobs") && sql.includes('materialize')) {
        insertedJobs.push(params);
        return { rows: [{ id: 99 }] };
      }
      return { rows: [] };
    });

    (parseRunService.getCurrentParsedResult as jest.Mock).mockResolvedValue(null);
    (parseRunService.createParseRun as jest.Mock).mockResolvedValue({ id: 100, fingerprint: 'fp' });
    (parseRunService.markRunning as jest.Mock).mockResolvedValue(undefined);
    (parseRunService.finalizeParseRun as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('does not call LLM and enqueues materialize job', async () => {
    await service.executeImportJob({ id: 55, report_id: 3, version_id: 9 });
    expect(createLlmProvider).not.toHaveBeenCalled();
    expect(parseRunService.createParseRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: null })
    );
    const finalizeArg = (parseRunService.finalizeParseRun as jest.Mock).mock.calls[0][0];
    expect(finalizeArg.enqueueFollowupJobs).toBe(false);
    expect(insertedJobs.length).toBe(1);
    expect(insertedJobs[0].slice(0, 3)).toEqual([3, 9, undefined].slice(0, 2).concat([]));
    // INSERT params: reportId, versionId, ...
    expect(insertedJobs[0][0]).toBe(3);
    expect(insertedJobs[0][1]).toBe(9);
  });

  it('rejects PDF hash mismatch before parse write', async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM report_versions rv')) {
        return {
          rows: [
            {
              id: 9,
              report_id: 3,
              package_sha256: hashes.packageHash,
              ingestion_mode: 'structured_import',
              parsed_json: {},
              package_path: path.join(tmp, 'package.kirogov.zip'),
              package_sha256_artifact: hashes.packageHash,
              pdf_path: path.join(tmp, 'source.pdf'),
              pdf_sha256: '00'.repeat(32),
              md_path: path.join(tmp, 'source.md'),
              md_sha256: hashes.mdHash,
              json_path: path.join(tmp, 'source.json'),
              json_sha256: hashes.jsonHash,
            },
          ],
        };
      }
      return { rows: [] };
    });
    await expect(
      service.executeImportJob({ id: 55, report_id: 3, version_id: 9 })
    ).rejects.toMatchObject({ code: 'PDF_HASH_MISMATCH' });
    expect(parseRunService.finalizeParseRun).not.toHaveBeenCalled();
  });
});
