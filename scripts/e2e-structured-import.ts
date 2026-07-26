/**
 * Structured-import E2E against an isolated Postgres database AND an isolated
 * temporary DATA_DIR.
 *
 *  - DB: creates `kirogov_structured_e2e` (override with E2E_DB_NAME); NEVER
 *    uses DB_NAME from .env as the test target; dropped in finally.
 *  - Files: sets KIROGOV_DATA_DIR to os.tmpdir()/kirogov-structured-e2e-<rand>
 *    BEFORE importing any src module, so uploads/staging/published packages
 *    never touch the real <project>/data directory; removed in finally.
 *  - LLM: patches createLlmProvider to throw and counts calls; asserts 0.
 *  - Covers: import → idempotent re-upload → worker drain (import →
 *    materialize → checks) → downstream recovery (materialize failed, checks
 *    failed + re-upload heal, nothing-to-retry) → cleanliness verification.
 *
 *   npx ts-node --transpile-only scripts/e2e-structured-import.ts
 *   E2E_KEEP_DB=1 npx ts-node --transpile-only scripts/e2e-structured-import.ts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client } from 'pg';

dotenv.config();

const E2E_DB = process.env.E2E_DB_NAME || 'kirogov_structured_e2e';
const KEEP = process.env.E2E_KEEP_DB === '1';
const PROD_DB = process.env.DB_NAME || '';

// Isolated data root — MUST be set before any ../src import (constants.ts
// reads KIROGOV_DATA_DIR at module load).
const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kirogov-structured-e2e-'));
process.env.KIROGOV_DATA_DIR = TMP_DATA_DIR;

function adminConfig(database: string) {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database,
  };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function ensureDatabase(): Promise<void> {
  if (!E2E_DB || E2E_DB === PROD_DB) {
    throw new Error(`Refusing E2E_DB_NAME=${E2E_DB} (must differ from DB_NAME=${PROD_DB})`);
  }
  if (/cloud_restore|production|prod/i.test(E2E_DB) && process.env.E2E_ALLOW_DANGEROUS !== '1') {
    throw new Error(`Suspicious E2E_DB_NAME=${E2E_DB}`);
  }

  const client = new Client(adminConfig('postgres'));
  await client.connect();
  try {
    const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [E2E_DB]);
    if (!found.rowCount) {
      await client.query(`CREATE DATABASE ${quoteIdent(E2E_DB)}`);
      console.log('[e2e] created', E2E_DB);
    } else {
      console.log('[e2e] reusing', E2E_DB);
    }
  } finally {
    await client.end();
  }
}

async function dropDatabase(): Promise<void> {
  if (KEEP) {
    console.log('[e2e] E2E_KEEP_DB=1, keeping', E2E_DB);
    return;
  }
  const client = new Client(adminConfig('postgres'));
  await client.connect();
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [E2E_DB]
    );
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(E2E_DB)}`);
    console.log('[e2e] dropped', E2E_DB);
  } finally {
    await client.end();
  }
}

/** Snapshot of the REAL project data/uploads dir (must stay untouched). */
function realDataSnapshot(projectRoot: string): { tmpE2eZips: number; packageDirs: number } {
  const realUploads = path.join(projectRoot, 'data', 'uploads');
  let tmpE2eZips = 0;
  let packageDirs = 0;
  try {
    const tmpDir = path.join(realUploads, 'tmp');
    if (fs.existsSync(tmpDir)) {
      tmpE2eZips = fs.readdirSync(tmpDir).filter((f) => /^e2e.*\.kirogov\.zip$/i.test(f)).length;
    }
    if (fs.existsSync(realUploads)) {
      for (const region of fs.readdirSync(realUploads, { withFileTypes: true })) {
        if (!region.isDirectory() || region.name === 'tmp') continue;
        const regionDir = path.join(realUploads, region.name);
        for (const year of fs.readdirSync(regionDir, { withFileTypes: true })) {
          if (!year.isDirectory()) continue;
          const packagesDir = path.join(regionDir, year.name, 'packages');
          if (fs.existsSync(packagesDir)) {
            packageDirs += fs
              .readdirSync(packagesDir, { withFileTypes: true })
              .filter((d) => d.isDirectory() && d.name !== '.staging').length;
          }
        }
      }
    }
  } catch {
    /* snapshot is best-effort */
  }
  return { tmpE2eZips, packageDirs };
}

let poolRef: { end: () => Promise<void>; query: (sql: string, params?: any[]) => Promise<any> } | null =
  null;

async function cleanupAll(): Promise<void> {
  if (poolRef) {
    await poolRef.end().catch(() => undefined);
    poolRef = null;
  }
  try {
    await dropDatabase();
  } catch (e: any) {
    console.error('[e2e] drop cleanup failed', e?.message || e);
  }
  try {
    fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true });
  } catch (e: any) {
    console.error('[e2e] temp DATA_DIR cleanup failed', e?.message || e);
  }
  console.log(
    '[e2e] temp DATA_DIR removed:',
    !fs.existsSync(TMP_DATA_DIR),
    '(', TMP_DATA_DIR, ')'
  );
}

async function main(): Promise<void> {
  console.log('[e2e] production DB_NAME (untouched):', PROD_DB || '(unset)');
  console.log('[e2e] isolated DB target:', E2E_DB);
  console.log('[e2e] isolated DATA_DIR:', TMP_DATA_DIR);

  await ensureDatabase();

  // Switch all subsequent pool usage to the isolated DB
  process.env.DB_NAME = E2E_DB;
  process.env.DATABASE_TYPE = 'postgres';

  const { PROJECT_ROOT, DATA_DIR } = await import('../src/config/constants');
  if (path.resolve(DATA_DIR) !== path.resolve(TMP_DATA_DIR)) {
    throw new Error(`DATA_DIR isolation failed: ${DATA_DIR} != ${TMP_DATA_DIR}`);
  }
  const realBefore = realDataSnapshot(PROJECT_ROOT);
  console.log('[e2e] real data/uploads snapshot before:', realBefore);

  // LLM guard: any provider construction fails loudly and is counted.
  const providerFactory = await import('../src/services/LlmProviderFactory');
  let llmCreateCalls = 0;
  (providerFactory as any).createLlmProvider = () => {
    llmCreateCalls += 1;
    throw new Error('E2E: createLlmProvider must not be called by the structured-import pipeline');
  };

  const { runRegisteredMigrations } = await import('../src/db/migrationRunner');
  const { getRegisteredMigrations, MIGRATION_SYSTEM_NAME } = await import('../src/db/migrationRegistry');
  const pool = (await import('../src/config/database-llm')).default;
  poolRef = pool as any;

  console.log('[e2e] migrate...');
  const mig = await runRegisteredMigrations({
    pool: pool as any,
    migrations: getRegisteredMigrations(),
    systemName: MIGRATION_SYSTEM_NAME,
  });
  for (const step of mig.steps || []) {
    console.log(`  - ${step.migrationId}: ${step.status}${step.message ? ' ' + step.message : ''}`);
  }

  // Seed region
  let regionId: number;
  try {
    const ins = await pool.query(
      `INSERT INTO regions (code, name, level)
       VALUES ($1, $2, 1)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [`e2e-${Date.now()}`, 'E2E测试区域']
    );
    regionId = Number(ins.rows[0].id);
  } catch (e: any) {
    console.warn('[e2e] region insert failed, try select', e.message);
    const sel = await pool.query(`SELECT id FROM regions ORDER BY id ASC LIMIT 1`);
    if (!sel.rows[0]) throw e;
    regionId = Number(sel.rows[0].id);
  }
  console.log('[e2e] region_id=', regionId);

  const fixtureDir = path.join(process.cwd(), 'tests', 'fixtures', 'structured-import');
  const fixture = path.join(fixtureDir, 'valid-sample.kirogov.zip');
  if (!fs.existsSync(fixture)) {
    const { generateStructuredImportFixtures } = await import('./generate-structured-import-fixtures');
    await generateStructuredImportFixtures(fixtureDir);
  }
  if (!fs.existsSync(fixture)) {
    throw new Error('missing fixture ' + fixture);
  }

  // Upload temp zips live inside the ISOLATED data dir, not the project tree.
  const tmpUploadDir = path.join(TMP_DATA_DIR, 'uploads', 'tmp');
  fs.mkdirSync(tmpUploadDir, { recursive: true });
  const tmpZip = path.join(tmpUploadDir, `e2e-${Date.now()}.kirogov.zip`);
  fs.copyFileSync(fixture, tmpZip);

  const { structuredImportService } = await import(
    '../src/services/structured-import/StructuredImportService'
  );

  console.log('[e2e] processImport #1');
  const r1 = await structuredImportService.processImport({
    regionId,
    year: 2024,
    unitName: '测试机构',
    tempZipPath: tmpZip,
    originalName: 'valid-sample.kirogov.zip',
    size: fs.statSync(tmpZip).size,
    createdBy: null,
  });
  console.log('[e2e] r1', {
    reportId: r1.reportId,
    versionId: r1.versionId,
    jobId: r1.jobId,
    reusedVersion: r1.reusedVersion,
    packageSha256: r1.packageSha256.slice(0, 12) + '...',
  });

  // Idempotent re-upload
  const tmpZip2 = path.join(tmpUploadDir, `e2e2-${Date.now()}.kirogov.zip`);
  fs.copyFileSync(fixture, tmpZip2);
  console.log('[e2e] processImport #2 (idempotent)');
  const r2 = await structuredImportService.processImport({
    regionId,
    year: 2024,
    unitName: '测试机构',
    tempZipPath: tmpZip2,
    originalName: 'valid-sample.kirogov.zip',
    size: fs.statSync(tmpZip2).size,
    createdBy: null,
  });
  console.log('[e2e] r2', {
    versionId: r2.versionId,
    jobId: r2.jobId,
    reusedVersion: r2.reusedVersion,
  });
  if (r2.versionId !== r1.versionId) {
    throw new Error(`idempotency failed: ${r1.versionId} vs ${r2.versionId}`);
  }
  if (!r2.reusedVersion) {
    console.warn('[e2e] warn: reusedVersion=false on second import (acceptable if race)');
  }

  const { llmJobRunner } = await import('../src/services/LlmJobRunner');
  const { determineCorePipelineStatus, buildUploadPipelineSummary } = await import(
    '../src/utils/jobPipeline'
  );

  async function drainUntilSettled(label: string, maxJobs = 16): Promise<void> {
    let drained = 0;
    for (let i = 0; i < maxJobs; i++) {
      const id = await llmJobRunner.processNextQueuedJob();
      if (id == null) break;
      drained += 1;
      const statuses = await pool.query(
        `SELECT kind, status FROM jobs WHERE version_id = $1 ORDER BY id`,
        [r1.versionId]
      );
      console.log(
        `[e2e] (${label}) processed job ${id}:`,
        statuses.rows.map((r: any) => r.kind + '=' + r.status).join(', ')
      );
      const overall = determineCorePipelineStatus(statuses.rows);
      if (overall === 'succeeded') break;
      if (overall === 'failed') {
        throw new Error(`pipeline failed mid-drain (${label}): ` + JSON.stringify(statuses.rows));
      }
    }
    console.log(`[e2e] (${label}) drained job count`, drained);
  }

  console.log('[e2e] drain worker queue (claimNextJob + processJob path)');
  await pool.query(
    `UPDATE jobs SET status = 'queued', started_at = NULL, finished_at = NULL,
         error_code = NULL, error_message = NULL
     WHERE id = $1 AND kind = 'structured_import'`,
    [r1.jobId]
  );
  await drainUntilSettled('initial');

  const jobRows = await pool.query(
    `SELECT kind, status FROM jobs WHERE version_id = $1 ORDER BY id`,
    [r1.versionId]
  );
  const byKind: Record<string, string> = {};
  for (const row of jobRows.rows) byKind[String(row.kind)] = String(row.status);
  console.log('[e2e] final job statuses', byKind);
  for (const kind of ['structured_import', 'materialize', 'checks']) {
    if (byKind[kind] !== 'succeeded') {
      throw new Error(`${kind} not succeeded via worker: ${byKind[kind]}`);
    }
  }
  if (determineCorePipelineStatus(jobRows.rows) !== 'succeeded') {
    throw new Error('pipeline overall != succeeded');
  }
  if (!buildUploadPipelineSummary(jobRows.rows).all_core_succeeded) {
    throw new Error('all_core_succeeded false');
  }

  // --- Core data assertions ---
  const ver = await pool.query(
    `SELECT ingestion_mode, package_sha256, provider, model, parsed_json
     FROM report_versions WHERE id = $1`,
    [r1.versionId]
  );
  const v = ver.rows[0];
  if (!v) throw new Error('version missing');
  if (v.ingestion_mode !== 'structured_import') throw new Error('ingestion_mode=' + v.ingestion_mode);
  if (!v.package_sha256 || String(v.package_sha256).length !== 64) throw new Error('package_sha256 invalid');
  if (String(v.provider) !== 'structured_import') throw new Error('provider=' + v.provider);
  const parsed = typeof v.parsed_json === 'string' ? JSON.parse(v.parsed_json) : v.parsed_json;
  if (!Array.isArray(parsed?.sections) || parsed.sections.length === 0) {
    throw new Error('parsed_json.sections empty');
  }
  if (parsed?._ingestion?.mode !== 'structured_import') throw new Error('_ingestion.mode missing');

  const arts = await pool.query(
    `SELECT artifact_type FROM report_version_artifacts WHERE report_version_id = $1`,
    [r1.versionId]
  );
  const types = new Set(arts.rows.map((r: any) => r.artifact_type));
  for (const t of ['source_package', 'source_pdf', 'source_markdown', 'source_json']) {
    if (!types.has(t)) throw new Error('missing artifact ' + t);
  }

  async function factTotal(): Promise<number> {
    const facts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM fact_active_disclosure WHERE version_id = $1) AS active_n,
         (SELECT COUNT(*)::int FROM fact_application WHERE version_id = $1) AS app_n,
         (SELECT COUNT(*)::int FROM fact_legal_proceeding WHERE version_id = $1) AS legal_n`,
      [r1.versionId]
    );
    const f = facts.rows[0];
    return Number(f.active_n || 0) + Number(f.app_n || 0) + Number(f.legal_n || 0);
  }
  const factsAfterInitial = await factTotal();
  console.log('[e2e] facts total =', factsAfterInitial);
  if (factsAfterInitial <= 0) throw new Error('no materialized facts');

  async function consistencyItemCount(): Promise<number> {
    const q = await pool.query(
      `SELECT COUNT(*)::int AS n FROM report_consistency_items WHERE report_version_id = $1`,
      [r1.versionId]
    );
    return Number(q.rows[0]?.n || 0);
  }
  const checkRuns = await pool.query(
    `SELECT COUNT(*)::int AS n FROM report_consistency_runs WHERE report_version_id = $1`,
    [r1.versionId]
  );
  if (Number(checkRuns.rows[0]?.n || 0) <= 0) throw new Error('expected consistency check run');
  const itemsAfterInitial = await consistencyItemCount();
  console.log('[e2e] consistency items =', itemsAfterInitial);

  // Published files must be inside the ISOLATED data dir.
  const publishedPdf = path.join(
    DATA_DIR,
    'uploads',
    String(regionId),
    '2024',
    'packages',
    String(v.package_sha256),
    'source.pdf'
  );
  if (!fs.existsSync(publishedPdf)) throw new Error('published source.pdf missing: ' + publishedPdf);
  if (!publishedPdf.startsWith(TMP_DATA_DIR)) throw new Error('published file escaped temp DATA_DIR');

  // ==========================================================
  // Downstream recovery scenarios (P2: materialize/checks failed)
  // ==========================================================
  const { recoverVersionDownstream } = await import('../src/services/PipelineRecoveryService');

  async function activeCount(kind: string): Promise<number> {
    const q = await pool.query(
      `SELECT COUNT(*)::int AS n FROM jobs
       WHERE version_id = $1 AND kind = $2 AND status IN ('queued','running')`,
      [r1.versionId, kind]
    );
    return Number(q.rows[0]?.n || 0);
  }

  // R1: materialize failed → concurrent recovery requests → single requeued job → drain to success
  console.log('[e2e] recovery R1: simulate materialize failure');
  await pool.query(
    `UPDATE jobs SET status = 'failed', error_code = 'MATERIALIZE_EMPTY_FACTS',
         error_message = 'e2e simulated failure', finished_at = NOW()
     WHERE id = (SELECT id FROM jobs WHERE version_id = $1 AND kind = 'materialize' ORDER BY id DESC LIMIT 1)`,
    [r1.versionId]
  );
  const [rec1a, rec1b] = await Promise.all([
    recoverVersionDownstream(r1.versionId),
    recoverVersionDownstream(r1.versionId),
  ]);
  console.log('[e2e] recovery R1 results', rec1a, rec1b);
  if (rec1a.action !== 'requeued' || rec1b.action !== 'requeued') {
    throw new Error('R1: both recovery calls must requeue/reuse');
  }
  if (rec1a.kind !== 'materialize' || rec1b.kind !== 'materialize') {
    throw new Error('R1: expected materialize requeue');
  }
  if (rec1a.jobId !== rec1b.jobId) {
    throw new Error(`R1: concurrent recovery created two jobs: ${rec1a.jobId} vs ${rec1b.jobId}`);
  }
  if ((await activeCount('materialize')) !== 1) {
    throw new Error('R1: expected exactly one active materialize job');
  }
  await drainUntilSettled('recovery-materialize');
  const afterR1 = await pool.query(
    `SELECT kind, status FROM jobs WHERE version_id = $1 ORDER BY id`,
    [r1.versionId]
  );
  if (determineCorePipelineStatus(afterR1.rows) !== 'succeeded') {
    throw new Error('R1: pipeline not succeeded after materialize recovery');
  }
  const factsAfterR1 = await factTotal();
  const itemsAfterR1 = await consistencyItemCount();
  if (factsAfterR1 !== factsAfterInitial) {
    throw new Error(`R1: facts duplicated/lost: ${factsAfterInitial} -> ${factsAfterR1}`);
  }
  if (itemsAfterR1 !== itemsAfterInitial) {
    throw new Error(`R1: consistency items duplicated/lost: ${itemsAfterInitial} -> ${itemsAfterR1}`);
  }
  console.log('[e2e] recovery R1 OK (facts and items stable)');

  // R2: checks failed → re-upload same package heals downstream via job reuse
  console.log('[e2e] recovery R2: simulate checks failure + re-upload heal');
  await pool.query(
    `UPDATE jobs SET status = 'failed', error_code = 'E2E_SIMULATED',
         error_message = 'e2e simulated checks failure', finished_at = NOW()
     WHERE id = (SELECT id FROM jobs WHERE version_id = $1 AND kind = 'checks' ORDER BY id DESC LIMIT 1)`,
    [r1.versionId]
  );
  const tmpZip3 = path.join(tmpUploadDir, `e2e3-${Date.now()}.kirogov.zip`);
  fs.copyFileSync(fixture, tmpZip3);
  const r3 = await structuredImportService.processImport({
    regionId,
    year: 2024,
    unitName: '测试机构',
    tempZipPath: tmpZip3,
    originalName: 'valid-sample.kirogov.zip',
    size: fs.statSync(tmpZip3).size,
    createdBy: null,
  });
  if (!r3.reusedVersion || r3.versionId !== r1.versionId) {
    throw new Error('R2: expected version reuse on re-upload');
  }
  if ((await activeCount('checks')) !== 1) {
    throw new Error('R2: re-upload should have requeued exactly one checks job');
  }
  await drainUntilSettled('recovery-checks');
  const afterR2 = await pool.query(
    `SELECT kind, status FROM jobs WHERE version_id = $1 ORDER BY id`,
    [r1.versionId]
  );
  if (determineCorePipelineStatus(afterR2.rows) !== 'succeeded') {
    throw new Error('R2: pipeline not succeeded after checks recovery');
  }
  const itemsAfterR2 = await consistencyItemCount();
  if (itemsAfterR2 !== itemsAfterInitial) {
    throw new Error(`R2: consistency items duplicated/lost: ${itemsAfterInitial} -> ${itemsAfterR2}`);
  }
  console.log('[e2e] recovery R2 OK (re-upload healed checks)');

  // R3: everything succeeded → nothing to retry
  const rec3 = await recoverVersionDownstream(r1.versionId);
  if (rec3.action !== 'none' || rec3.reason !== 'nothing_to_retry') {
    throw new Error('R3: expected nothing_to_retry, got ' + JSON.stringify(rec3));
  }
  console.log('[e2e] recovery R3 OK (nothing_to_retry)');

  // LLM must never have been constructed.
  if (llmCreateCalls !== 0) {
    throw new Error(`LLM provider was constructed ${llmCreateCalls} time(s) — must be 0`);
  }
  console.log('[e2e] LLM createLlmProvider calls =', llmCreateCalls);

  // Real project data dir must be untouched.
  const realAfter = realDataSnapshot(PROJECT_ROOT);
  console.log('[e2e] real data/uploads snapshot after:', realAfter);
  if (
    realAfter.tmpE2eZips !== realBefore.tmpE2eZips ||
    realAfter.packageDirs !== realBefore.packageDirs
  ) {
    throw new Error(
      `real data/uploads polluted: before=${JSON.stringify(realBefore)} after=${JSON.stringify(realAfter)}`
    );
  }

  console.log('[e2e] ==============================');
  console.log('[e2e] PASS structured-import E2E');
  console.log('[e2e] ==============================');
}

main()
  .then(async () => {
    await cleanupAll();
  })
  .catch(async (err) => {
    console.error('[e2e] FAIL', err?.stack || err);
    await cleanupAll();
    process.exit(1);
  });
