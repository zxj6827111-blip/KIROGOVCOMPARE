import { govInsightLeaderCockpitService } from '../src/services/GovInsightLeaderCockpitService';
import { govInsightReportPayloadService } from '../src/services/GovInsightReportPayloadService';

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.split('=')[1]);
  return Number.isFinite(value) ? value : fallback;
}

async function main(): Promise<void> {
  const regionId = parseArg('region', 721);
  const year = parseArg('year', 2024);

  const model = await govInsightLeaderCockpitService.buildModel(regionId, year);
  const districtComparison = await govInsightLeaderCockpitService.buildComparisonModel(regionId, year, 'district', {
    disclosureMethod: 'substantive',
    correctionMethod: 'reconsideration',
    includesCarryOver: false,
    enableStableSample: true,
  });
  const departmentComparison = await govInsightLeaderCockpitService.buildComparisonModel(regionId, year, 'department', {
    disclosureMethod: 'substantive',
    correctionMethod: 'reconsideration',
    includesCarryOver: false,
    enableStableSample: true,
  });
  const payload = await govInsightReportPayloadService.build(regionId, year);

  console.log(
    JSON.stringify(
      {
        regionId,
        year,
        model: model
          ? {
              city: model.city,
              seriesYears: model.seriesYears,
              newApplications: model.metrics.newApplications.value,
              acceptedTotal: model.metrics.acceptedTotal.value,
            }
          : null,
        districtComparison: districtComparison
          ? {
              total: districtComparison.statistics.total,
              ranked: districtComparison.rankings.byDisclosureRate.slice(0, 3).map((item) => ({
                id: item.id,
                name: item.name,
                disclosureRate: item.disclosureRate,
                riskLevel: item.riskLevel,
              })),
            }
          : null,
        departmentComparison: departmentComparison
          ? {
              total: departmentComparison.statistics.total,
              ranked: departmentComparison.rankings.byCorrectionRate.slice(0, 3).map((item) => ({
                id: item.id,
                name: item.name,
                correctionRate: item.correctionRate,
                riskLevel: item.riskLevel,
              })),
            }
          : null,
        hierarchyAnalysis: payload.hierarchyAnalysis
          ? {
              districtCoverage: payload.hierarchyAnalysis.districtCoverage,
              departmentCoverage: payload.hierarchyAnalysis.departmentCoverage,
              districtFocusCount: payload.hierarchyAnalysis.districtFocus.length,
              departmentFocusCount: payload.hierarchyAnalysis.departmentFocus.length,
            }
          : null,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
