import { runLLMMigrations } from '../src/db/migrations-llm';
import pool from '../src/config/database-llm';
import { canonicalUnitsService } from '../src/services/CanonicalUnitsService';
import { govInsightStatsV2Service } from '../src/services/GovInsightStatsV2Service';
import { govInsightReportPayloadService } from '../src/services/GovInsightReportPayloadService';

function readNumericArg(name: string): number | undefined {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

async function main(): Promise<void> {
  const regionId = readNumericArg('region');
  const year = readNumericArg('year');
  const skipMigrate = process.argv.includes('--skip-migrate');

  console.log('[GovInsight Phase1 Bootstrap] start', {
    regionId: regionId ?? 'ALL',
    year: year ?? 'ALL',
    skipMigrate,
  });

  if (!skipMigrate) {
    console.log('[GovInsight Phase1 Bootstrap] running migrations...');
    await runLLMMigrations();
  }

  console.log('[GovInsight Phase1 Bootstrap] seeding phase1 frozen overrides...');
  const overrideSeedResult = await canonicalUnitsService.seedPhase1FrozenOverrides();

  console.log('[GovInsight Phase1 Bootstrap] syncing canonical_units...');
  const canonicalResult = await canonicalUnitsService.syncAll();

  console.log('[GovInsight Phase1 Bootstrap] materializing gov_open_annual_stats_v2...');
  const statsResult = await govInsightStatsV2Service.materialize({ regionId, year });

  console.log('[GovInsight Phase1 Bootstrap] done', {
    overrideSeedUpserts: overrideSeedResult.upserts,
    canonicalUpserts: canonicalResult.upserts,
    statsDeleted: statsResult.deleted,
    statsInserted: statsResult.inserted,
  });

  if (regionId && year) {
    console.log('[GovInsight Phase1 Bootstrap] building sample payload...');
    const payload = await govInsightReportPayloadService.build(regionId, year);
    console.log(
      JSON.stringify(
        {
          regionId: payload.regionId,
          year: payload.year,
          orgName: payload.orgName,
          unitType: payload.unitType,
          materializeStatus: payload.materializeStatus,
          metricVersion: payload.metricVersion,
          mappingVersion: payload.mappingVersion,
          sourceReportVersionId: payload.sourceReportVersionId,
          riskAssessment: payload.riskAssessment,
          scorecards: payload.metricsSnapshot.scorecards,
          warnings: payload.dataQuality.warnings,
        },
        null,
        2
      )
    );
  }
}

main()
  .catch((error) => {
    console.error('[GovInsight Phase1 Bootstrap] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
