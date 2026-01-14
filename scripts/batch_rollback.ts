import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { dbQuery, dbExecute, dbNowExpression, dbType } from '../src/config/db-llm';
import { sqlValue } from '../src/config/sqlite';

dotenv.config();

function parseArgs() {
  const args = process.argv.slice(2);
  const batchUuid = args[0];
  const operatorArg = args.find((arg) => arg.startsWith('--operator='));
  const operator = operatorArg ? operatorArg.split('=')[1] : process.env.OPERATOR_ID || 'unknown';
  return { batchUuid, operator };
}

async function rollbackBatch(batchUuid: string, operator: string): Promise<void> {
  const batch = (await dbQuery(
    `SELECT id, batch_uuid, status FROM ingestion_batches WHERE batch_uuid = $1 LIMIT 1`,
    [batchUuid]
  ))[0];

  if (!batch) {
    throw new Error(`Batch not found for uuid=${batchUuid}`);
  }

  const versions = await dbQuery(
    `SELECT id, report_id FROM report_versions WHERE ingestion_batch_id = $1`,
    [batch.id]
  );

  const versionIds = versions.map((v: any) => Number(v.id)).filter((v: number) => Number.isFinite(v));
  const reportIds = Array.from(new Set(versions.map((v: any) => Number(v.report_id)).filter((v: number) => Number.isFinite(v))));

  if (versionIds.length === 0) {
    console.log(`[batch_rollback] No versions found for batch ${batchUuid}. Nothing to rollback.`);
    return;
  }

  const versionIdList = versionIds.map((id: number) => sqlValue(id)).join(', ');

  await dbExecute(`UPDATE report_versions SET state = 'rolled_back', is_active = ${dbType === 'postgres' ? 'false' : '0'}, updated_at = ${dbNowExpression()} WHERE id IN (${versionIdList});`);
  await dbExecute(`DELETE FROM cells WHERE version_id IN (${versionIdList});`);
  await dbExecute(`DELETE FROM fact_active_disclosure WHERE version_id IN (${versionIdList});`);
  await dbExecute(`DELETE FROM fact_application WHERE version_id IN (${versionIdList});`);
  await dbExecute(`DELETE FROM fact_legal_proceeding WHERE version_id IN (${versionIdList});`);

  for (const reportId of reportIds) {
    const latest = (await dbQuery(
      `SELECT id FROM report_versions
       WHERE report_id = $1
         AND (state IS NULL OR state != 'rolled_back')
       ORDER BY created_at DESC
       LIMIT 1`,
      [reportId]
    ))[0];

    if (latest?.id) {
      await dbExecute(
        `UPDATE reports SET active_version_id = ${sqlValue(latest.id)}, updated_at = ${dbNowExpression()} WHERE id = ${sqlValue(reportId)};`
      );
      await dbExecute(
        `UPDATE report_versions SET is_active = ${dbType === 'postgres' ? 'true' : '1'} WHERE id = ${sqlValue(latest.id)};`
      );
    } else {
      await dbExecute(
        `UPDATE reports SET active_version_id = NULL, updated_at = ${dbNowExpression()} WHERE id = ${sqlValue(reportId)};`
      );
    }
  }

  const logEntry = {
    batch_uuid: batchUuid,
    operator,
    timestamp: new Date().toISOString(),
    affected_versions: versionIds.length,
    affected_reports: reportIds.length,
  };

  const logDir = path.join(process.cwd(), 'data', 'ops');
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(logDir, 'batch_rollback.log'), `${JSON.stringify(logEntry)}\n`);

  console.log(`[batch_rollback] Completed rollback for batch ${batchUuid}.`, logEntry);
}

async function main() {
  const { batchUuid, operator } = parseArgs();
  if (!batchUuid) {
    console.error('Usage: ts-node scripts/batch_rollback.ts <batch_uuid> [--operator=NAME]');
    process.exit(1);
  }

  try {
    await rollbackBatch(batchUuid, operator);
  } catch (error) {
    console.error('[batch_rollback] Failed:', error);
    process.exit(1);
  }
}

main();
