import pool from '../config/database-llm';

type Numeric = number | null;

interface VersionTarget {
  versionId: number;
  reportId: number;
}

interface ParsedCheckItem {
  applicantType: string;
  responseType: string;
  parsedValue?: Numeric;
  factValue?: Numeric;
  status: 'match' | 'mismatch' | 'missing_in_fact' | 'missing_in_parsed';
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function toInt(value: string | undefined): number | null {
  if (!value) return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
}

function parseJson(input: unknown): any {
  if (input === null || input === undefined) return null;
  if (typeof input === 'object') return input;
  if (typeof input !== 'string') return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function getNested(source: any, path: string[]): any {
  return path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), source);
}

function getSection(parsed: any, sectionType: string): any {
  const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  return sections.find((section: any) => section?.type === sectionType);
}

function coerceNumber(value: any): Numeric {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed === '/' || trimmed === '-' || trimmed === '--') return null;
    const normalized = trimmed.replace(/,/g, '');
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function keyOf(applicantType: string, responseType: string): string {
  return `${applicantType}::${responseType}`;
}

function extractParsedExpectations(parsed: any): Map<string, Numeric> {
  const table3Section = getSection(parsed, 'table_3');
  const tableData = table3Section?.tableData ?? parsed?.tableData ?? null;

  const expected = new Map<string, Numeric>();
  if (!tableData || typeof tableData !== 'object') {
    return expected;
  }

  const applicantMap = [
    { path: ['naturalPerson'], label: 'natural_person' },
    { path: ['legalPerson', 'commercial'], label: 'legal_person_commercial' },
    { path: ['legalPerson', 'research'], label: 'legal_person_research' },
    { path: ['legalPerson', 'social'], label: 'legal_person_social' },
    { path: ['legalPerson', 'legal'], label: 'legal_person_legal' },
    { path: ['legalPerson', 'other'], label: 'legal_person_other' },
    { path: ['total'], label: 'total' },
  ];

  const responseMap: Array<{ responseType: string; path: string[] }> = [
    { responseType: 'new_received', path: ['newReceived'] },
    { responseType: 'carried_over', path: ['carriedOver'] },
    { responseType: 'granted', path: ['results', 'granted'] },
    { responseType: 'partial_grant', path: ['results', 'partialGrant'] },
    { responseType: 'denied_state_secret', path: ['results', 'denied', 'stateSecret'] },
    { responseType: 'denied_law_forbidden', path: ['results', 'denied', 'lawForbidden'] },
    { responseType: 'denied_safety_stability', path: ['results', 'denied', 'safetyStability'] },
    { responseType: 'denied_third_party_rights', path: ['results', 'denied', 'thirdPartyRights'] },
    { responseType: 'denied_internal_affairs', path: ['results', 'denied', 'internalAffairs'] },
    { responseType: 'denied_process_info', path: ['results', 'denied', 'processInfo'] },
    { responseType: 'denied_enforcement_case', path: ['results', 'denied', 'enforcementCase'] },
    { responseType: 'denied_admin_query', path: ['results', 'denied', 'adminQuery'] },
    { responseType: 'unable_no_info', path: ['results', 'unableToProvide', 'noInfo'] },
    { responseType: 'unable_need_creation', path: ['results', 'unableToProvide', 'needCreation'] },
    { responseType: 'unable_unclear', path: ['results', 'unableToProvide', 'unclear'] },
    { responseType: 'not_processed_complaint', path: ['results', 'notProcessed', 'complaint'] },
    { responseType: 'not_processed_repeat', path: ['results', 'notProcessed', 'repeat'] },
    { responseType: 'not_processed_publication', path: ['results', 'notProcessed', 'publication'] },
    { responseType: 'not_processed_massive_requests', path: ['results', 'notProcessed', 'massiveRequests'] },
    { responseType: 'not_processed_confirm_info', path: ['results', 'notProcessed', 'confirmInfo'] },
    { responseType: 'other_overdue_correction', path: ['results', 'other', 'overdueCorrection'] },
    { responseType: 'other_overdue_fee', path: ['results', 'other', 'overdueFee'] },
    { responseType: 'other_other_reasons', path: ['results', 'other', 'otherReasons'] },
    { responseType: 'total_processed', path: ['results', 'totalProcessed'] },
    { responseType: 'carried_forward', path: ['results', 'carriedForward'] },
  ];

  for (const applicant of applicantMap) {
    const applicantData = getNested(tableData, applicant.path);
    if (!applicantData) {
      continue;
    }

    for (const response of responseMap) {
      const value = getNested(applicantData, response.path);
      expected.set(keyOf(applicant.label, response.responseType), coerceNumber(value));
    }
  }

  return expected;
}

async function resolveTarget(versionArg: number | null, reportArg: number | null): Promise<VersionTarget> {
  if (versionArg) {
    const result = await pool.query(
      `SELECT id AS version_id, report_id
       FROM report_versions
       WHERE id = $1
       LIMIT 1`,
      [versionArg]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`version_not_found:${versionArg}`);
    }
    return { versionId: Number(row.version_id), reportId: Number(row.report_id) };
  }

  if (!reportArg) {
    throw new Error('missing_target');
  }

  const reportRes = await pool.query(
    `SELECT id, active_version_id
     FROM reports
     WHERE id = $1
     LIMIT 1`,
    [reportArg]
  );
  const report = reportRes.rows[0];
  if (!report) {
    throw new Error(`report_not_found:${reportArg}`);
  }

  if (report.active_version_id) {
    return { versionId: Number(report.active_version_id), reportId: Number(report.id) };
  }

  const versionRes = await pool.query(
    `SELECT id
     FROM report_versions
     WHERE report_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [reportArg]
  );
  const latestVersion = versionRes.rows[0];
  if (!latestVersion) {
    throw new Error(`report_has_no_versions:${reportArg}`);
  }

  return { versionId: Number(latestVersion.id), reportId: Number(report.id) };
}

async function main(): Promise<void> {
  const versionArg = toInt(parseArg('version'));
  const reportArg = toInt(parseArg('report'));

  const target = await resolveTarget(versionArg, reportArg);

  const versionRes = await pool.query(
    `SELECT rv.id,
            rv.report_id,
            rv.file_name,
            rv.provider,
            rv.model,
            rv.created_at,
            rv.updated_at,
            rv.is_active,
            rv.parsed_json,
            r.active_version_id
     FROM report_versions rv
     JOIN reports r ON r.id = rv.report_id
     WHERE rv.id = $1
     LIMIT 1`,
    [target.versionId]
  );
  const version = versionRes.rows[0];
  if (!version) {
    throw new Error(`version_not_found:${target.versionId}`);
  }

  const parsed = parseJson(version.parsed_json);
  const expectedMap = extractParsedExpectations(parsed);

  const factRes = await pool.query(
    `SELECT applicant_type, response_type, count
     FROM fact_application
     WHERE version_id = $1`,
    [target.versionId]
  );

  const factMap = new Map<string, Numeric>();
  for (const row of factRes.rows) {
    factMap.set(keyOf(row.applicant_type, row.response_type), coerceNumber(row.count));
  }

  const allKeys = new Set<string>([...expectedMap.keys(), ...factMap.keys()]);
  const compareItems: ParsedCheckItem[] = [];

  for (const key of allKeys) {
    const [applicantType, responseType] = key.split('::');
    const parsedValue = expectedMap.has(key) ? expectedMap.get(key) ?? null : undefined;
    const factValue = factMap.has(key) ? factMap.get(key) ?? null : undefined;

    let status: ParsedCheckItem['status'];
    if (parsedValue === undefined) {
      status = 'missing_in_parsed';
    } else if (factValue === undefined) {
      status = 'missing_in_fact';
    } else if (parsedValue === factValue) {
      status = 'match';
    } else {
      status = 'mismatch';
    }

    compareItems.push({
      applicantType,
      responseType,
      parsedValue,
      factValue,
      status,
    });
  }

  compareItems.sort((a, b) => {
    if (a.applicantType === b.applicantType) {
      return a.responseType.localeCompare(b.responseType);
    }
    return a.applicantType.localeCompare(b.applicantType);
  });

  const mismatches = compareItems.filter((item) => item.status !== 'match');

  const jobsRes = await pool.query(
    `SELECT id, kind, status, error_code, LEFT(COALESCE(error_message, ''), 300) AS error_message,
            provider, model, retry_count, created_at, started_at, finished_at
     FROM jobs
     WHERE version_id = $1
       AND kind IN ('parse', 'materialize', 'checks')
     ORDER BY id DESC`,
    [target.versionId]
  );

  const parseHistoryRes = await pool.query(
    `SELECT id, provider, model, created_at
     FROM report_version_parses
     WHERE report_version_id = $1
     ORDER BY id DESC
     LIMIT 8`,
    [target.versionId]
  );

  const latestMaterialize = jobsRes.rows.find((row: any) => row.kind === 'materialize');
  const table3Section = getSection(parsed, 'table_3');
  const table3Present = !!(table3Section?.tableData ?? parsed?.tableData);

  let diagnosis = 'unknown';
  if (!table3Present) {
    diagnosis = 'parse_stage_issue: table_3 missing in parsed_json';
  } else if (mismatches.length === 0) {
    diagnosis = 'consistent: parse output and fact_application match';
  } else if (!latestMaterialize || latestMaterialize.status !== 'succeeded') {
    diagnosis = 'materialize_not_completed_or_failed: check materialize job status';
  } else {
    diagnosis = 'likely_materialize_or_mapping_issue: parsed table_3 differs from fact_application';
  }

  const summary = {
    report_id: Number(version.report_id),
    version_id: Number(version.id),
    file_name: version.file_name,
    version_provider: version.provider,
    version_model: version.model,
    report_active_version_id: version.active_version_id ? Number(version.active_version_id) : null,
    version_is_active_flag: !!version.is_active,
    table_3_present: table3Present,
    parsed_expected_rows: expectedMap.size,
    fact_rows: factMap.size,
    mismatches: mismatches.length,
    diagnosis,
  };

  console.log('\n=== Trace Summary ===');
  console.log(JSON.stringify(summary, null, 2));

  console.log('\n=== Job History (latest first) ===');
  console.log(JSON.stringify(jobsRes.rows, null, 2));

  console.log('\n=== Parse History (latest first) ===');
  console.log(JSON.stringify(parseHistoryRes.rows, null, 2));

  console.log('\n=== Mismatch Details (first 120) ===');
  console.log(JSON.stringify(mismatches.slice(0, 120), null, 2));
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'missing_target') {
      console.error('[trace-parse-materialize] usage: ts-node src/scripts/trace-parse-materialize.ts --version=<id>');
      console.error('[trace-parse-materialize]    or: ts-node src/scripts/trace-parse-materialize.ts --report=<id>');
    }
    console.error('[trace-parse-materialize] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
