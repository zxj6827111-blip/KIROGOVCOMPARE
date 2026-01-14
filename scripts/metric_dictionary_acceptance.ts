import dotenv from 'dotenv';
import { dbExecute } from '../src/config/db-llm';
import { sqlValue } from '../src/config/sqlite';

dotenv.config();

async function runAcceptance(): Promise<void> {
  const metricKey = 'acceptance_test_key';

  await dbExecute(`DELETE FROM metric_dictionary WHERE metric_key = ${sqlValue(metricKey)};`);

  await dbExecute(`
    INSERT INTO metric_dictionary (metric_key, version, display_name, source_table, drilldown_source)
    VALUES (${sqlValue(metricKey)}, 1, '验收测试指标', 'facts', 'cells');
  `);

  let secondInsertFailed = false;
  try {
    await dbExecute(`
      INSERT INTO metric_dictionary (metric_key, version, display_name, source_table, drilldown_source)
      VALUES (${sqlValue(metricKey)}, 2, '验收测试指标-重复', 'facts', 'cells');
    `);
  } catch (error) {
    secondInsertFailed = true;
  }

  if (!secondInsertFailed) {
    throw new Error('Expected second active insert to fail, but it succeeded.');
  }

  await dbExecute(`
    INSERT INTO metric_dictionary (metric_key, version, display_name, source_table, drilldown_source, deprecated_at)
    VALUES (${sqlValue(metricKey)}, 3, '验收测试指标-历史', 'facts', 'cells', '2026-01-01');
  `);

  console.log('[metric_dictionary_acceptance] Passed');
}

runAcceptance().catch((error) => {
  console.error('[metric_dictionary_acceptance] Failed:', error);
  process.exit(1);
});
