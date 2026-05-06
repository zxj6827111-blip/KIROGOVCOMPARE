import pool from '../src/config/database-llm';
import { govInsightReportPayloadService } from '../src/services/GovInsightReportPayloadService';
import { validateGovInsightReportPayload } from '../src/services/GovInsightReportProtocol';

function readNumericArg(name: string): number | undefined {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

async function main(): Promise<void> {
  const regionId = readNumericArg('region');
  const year = readNumericArg('year');

  const [canonicalDist, statsStatus, blockedSample, reportProtocol] = await Promise.all([
    pool.query(`
      SELECT unit_type, COUNT(*) AS cnt
      FROM canonical_units
      GROUP BY unit_type
      ORDER BY cnt DESC, unit_type ASC
    `),
    pool.query(`
      SELECT materialize_status, COUNT(*) AS cnt
      FROM gov_open_annual_stats_v2
      GROUP BY materialize_status
      ORDER BY materialize_status ASC
    `),
    pool.query(`
      SELECT region_id, org_name, unit_type, materialize_status, year
      FROM gov_open_annual_stats_v2
      WHERE materialize_status = 'blocked_unknown_unit_type'
      ORDER BY year DESC, region_id ASC
      LIMIT 20
    `),
    pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE protocol_version = 'gov_insight_ai_report_v1') AS protocol_v1,
        COUNT(*) FILTER (WHERE payload_version = 'report_payload_v1') AS payload_v1,
        COUNT(*) FILTER (WHERE content_json ? '_reportFormat') AS envelope_rows,
        COUNT(*) FILTER (WHERE content_json ? 'reportPayload') AS payload_embedded_rows,
        COUNT(*) FILTER (WHERE content_json ? 'reportContent') AS report_content_rows,
        COUNT(*) FILTER (WHERE content_json ? 'narrative') AS narrative_rows
      FROM ai_decision_reports
    `),
  ]);

  console.log(
    JSON.stringify(
      {
        canonicalUnitDistribution: canonicalDist.rows,
        statsMaterializeStatus: statsStatus.rows,
        blockedUnknownSample: blockedSample.rows,
        aiReportProtocolSummary: reportProtocol.rows[0] || null,
      },
      null,
      2
    )
  );

  if (regionId && year) {
    const payload = await govInsightReportPayloadService.build(regionId, year);
    const payloadValidation = validateGovInsightReportPayload(payload);
    console.log(
      JSON.stringify(
        {
          samplePayload: {
            regionId: payload.regionId,
            orgName: payload.orgName,
            year: payload.year,
            unitType: payload.unitType,
            materializeStatus: payload.materializeStatus,
            metricVersion: payload.metricVersion,
            mappingVersion: payload.mappingVersion,
            sourceReportVersionId: payload.sourceReportVersionId,
            riskAssessment: payload.riskAssessment,
            scorecards: payload.metricsSnapshot.scorecards,
            warnings: payload.dataQuality.warnings,
            payloadValidation: {
              valid: payloadValidation.valid,
              errors: payloadValidation.errors,
            },
            seedSummary: {
              metadataTitle: payload.metadataSeeds.reportTitle,
              riskPrioritySeedCount: payload.riskPrioritySeeds.length,
              rectificationTaskCount: payload.rectificationTaskSkeleton.length,
              appendixMetricAuditRowCount: payload.appendixSkeleton.metricAuditRows.length,
              appendixBoundaryCount: payload.appendixSkeleton.usageBoundaries.length,
              appendixSupplementCount: payload.appendixSkeleton.supplementDataItems.length,
              contentBoundaryFactAllowed: payload.contentBoundaries.factConclusionAllowed,
            },
          },
        },
        null,
        2
      )
    );
  }
}

main()
  .catch((error) => {
    console.error('[GovInsight Phase1 Verify] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
