/**
 * Real shipped helpers: publishStagingDir + cleanupOrphanPackageDir + task aggregate.
 */
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  publishStagingDir,
  cleanupOrphanPackageDir,
} from '../services/structured-import/StructuredImportService';
import { aggregateStructuredImportTaskDisplay } from '../utils/structuredImportTaskAggregate';
import { determineCorePipelineStatus } from '../utils/jobPipeline';

describe('publishStagingDir (real function)', () => {
  let root: string;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pub-'));
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  test('renames staging dir to final atomically', async () => {
    const staging = path.join(root, 'staging');
    const finalDir = path.join(root, 'final');
    await fsp.mkdir(staging, { recursive: true });
    await fsp.writeFile(path.join(staging, 'source.pdf'), '%PDF-1.4');
    await publishStagingDir(staging, finalDir);
    expect(fs.existsSync(path.join(finalDir, 'source.pdf'))).toBe(true);
    expect(fs.existsSync(staging)).toBe(false);
  });

  test('if final already exists, drops staging and keeps final', async () => {
    const staging = path.join(root, 'staging2');
    const finalDir = path.join(root, 'final2');
    await fsp.mkdir(staging, { recursive: true });
    await fsp.mkdir(finalDir, { recursive: true });
    await fsp.writeFile(path.join(finalDir, 'source.pdf'), 'KEEP');
    await fsp.writeFile(path.join(staging, 'source.pdf'), 'NEW');
    await publishStagingDir(staging, finalDir);
    expect(fs.readFileSync(path.join(finalDir, 'source.pdf'), 'utf8')).toBe('KEEP');
    expect(fs.existsSync(staging)).toBe(false);
  });
});

describe('cleanupOrphanPackageDir (real function)', () => {
  let root: string;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'orphan-'));
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  test('removes dir when query finds no package_sha256 row', async () => {
    const finalDir = path.join(root, 'pkg');
    await fsp.mkdir(finalDir, { recursive: true });
    await fsp.writeFile(path.join(finalDir, 'source.pdf'), 'x');
    const removed = await cleanupOrphanPackageDir(finalDir, 'ab'.repeat(32), async () => ({
      rows: [],
    }));
    expect(removed).toBe(true);
    expect(fs.existsSync(finalDir)).toBe(false);
  });

  test('keeps dir when package_sha256 is referenced', async () => {
    const finalDir = path.join(root, 'pkg2');
    await fsp.mkdir(finalDir, { recursive: true });
    await fsp.writeFile(path.join(finalDir, 'source.pdf'), 'x');
    const removed = await cleanupOrphanPackageDir(finalDir, 'cd'.repeat(32), async () => ({
      rows: [{ '?column?': 1 }],
    }));
    expect(removed).toBe(false);
    expect(fs.existsSync(finalDir)).toBe(true);
  });
});

describe('aggregateStructuredImportTaskDisplay (real function)', () => {
  test('structured_import succeeded + materialize failed => failed not succeeded', () => {
    const jobs = [
      { kind: 'structured_import', status: 'succeeded', progress: 100 },
      {
        kind: 'materialize',
        status: 'failed',
        progress: 50,
        error_code: 'MATERIALIZE_EMPTY_FACTS',
        error_message: 'empty facts',
      },
    ];
    const agg = aggregateStructuredImportTaskDisplay(jobs[0], jobs);
    expect(agg.overall).toBe('failed');
    expect(agg.status).toBe('failed');
    expect(agg.all_core_succeeded).toBe(false);
    expect(agg.error_code).toBe('MATERIALIZE_EMPTY_FACTS');
    expect(determineCorePipelineStatus(jobs)).toBe('failed');
  });

  test('structured_import succeeded + materialize queued => processing not succeeded', () => {
    const jobs = [
      { kind: 'structured_import', status: 'succeeded', progress: 100 },
      { kind: 'materialize', status: 'queued', progress: 0 },
    ];
    const agg = aggregateStructuredImportTaskDisplay(jobs[0], jobs);
    expect(agg.status).toBe('processing');
    expect(agg.all_core_succeeded).toBe(false);
    expect(agg.overall).not.toBe('succeeded');
  });

  test('full chain succeeded => succeeded', () => {
    const jobs = [
      { kind: 'structured_import', status: 'succeeded', progress: 100 },
      { kind: 'materialize', status: 'succeeded', progress: 100 },
      { kind: 'checks', status: 'succeeded', progress: 100 },
    ];
    const agg = aggregateStructuredImportTaskDisplay(jobs[0], jobs);
    expect(agg.status).toBe('succeeded');
    expect(agg.progress).toBe(100);
    expect(agg.all_core_succeeded).toBe(true);
  });
});

/**
 * Structural proof: processImport publishes before COMMIT (source order).
 * Complements E2E which drives the real import path.
 */
describe('processImport publish-before-commit structure', () => {
  test('source orders publishStagingDir before COMMIT', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/structured-import/StructuredImportService.ts'),
      'utf8'
    );
    const pub = src.indexOf('await publishStagingDir(stagingAbs, finalAbs)');
    const commit = src.indexOf("await client.query('COMMIT')", pub);
    expect(pub).toBeGreaterThan(0);
    expect(commit).toBeGreaterThan(pub);
    expect(src).toMatch(/Publish files BEFORE commit/);
  });
});
