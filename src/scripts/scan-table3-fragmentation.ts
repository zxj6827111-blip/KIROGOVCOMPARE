import pool from '../config/database-llm';

type RowAggregate = {
  report_id: number;
  version_id: number;
  is_active: boolean;
  review_status: string | null;
  response_type: string;
  natural_person: number | null;
  legal_person_commercial: number | null;
  legal_person_research: number | null;
  legal_person_social: number | null;
  legal_person_legal: number | null;
  legal_person_other: number | null;
  total: number | null;
};

type EntityKey =
  | 'natural_person'
  | 'legal_person_commercial'
  | 'legal_person_research'
  | 'legal_person_social'
  | 'legal_person_legal'
  | 'legal_person_other';

type SuspiciousCandidate = {
  left_key: EntityKey;
  right_key: EntityKey;
  left_value: number;
  right_value: number;
  merged_value: number;
};

type SuspiciousRow = {
  report_id: number;
  version_id: number;
  is_active: boolean;
  review_status: string | null;
  response_type: string;
  total: number;
  entity_sum: number;
  delta: number;
  candidates: SuspiciousCandidate[];
};

const ENTITY_KEYS: EntityKey[] = [
  'natural_person',
  'legal_person_commercial',
  'legal_person_research',
  'legal_person_social',
  'legal_person_legal',
  'legal_person_other',
];

function parseArgs(argv: string[]) {
  const flags = new Set(argv);
  const limitFlag = argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitFlag ? Number(limitFlag.split('=')[1]) : 50;

  return {
    activeOnly: !flags.has('--all-versions'),
    json: flags.has('--json'),
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50,
  };
}

function toNumber(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isSingleDigitInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 9;
}

function findCandidates(row: RowAggregate): SuspiciousCandidate[] {
  const values = ENTITY_KEYS.map((key) => ({ key, value: toNumber(row[key]) }));
  const total = toNumber(row.total);
  const entitySum = values.reduce((acc, item) => acc + item.value, 0);
  if (entitySum === total) {
    return [];
  }

  const candidates: SuspiciousCandidate[] = [];
  for (let i = 0; i < values.length - 1; i += 1) {
    const left = values[i];
    const right = values[i + 1];
    if (!isSingleDigitInteger(left.value) || !isSingleDigitInteger(right.value)) {
      continue;
    }
    if (left.value === 0 && right.value === 0) {
      continue;
    }

    const mergedValue = Number(`${left.value}${right.value}`);
    const repairedSum = entitySum - left.value - right.value + mergedValue;
    if (repairedSum !== total) {
      continue;
    }

    candidates.push({
      left_key: left.key,
      right_key: right.key,
      left_value: left.value,
      right_value: right.value,
      merged_value: mergedValue,
    });
  }

  return candidates;
}

async function loadRows(activeOnly: boolean): Promise<RowAggregate[]> {
  const activeFilter = activeOnly ? 'WHERE rv.is_active = true' : '';
  const query = `
    WITH base AS (
      SELECT
        rv.report_id,
        rv.id AS version_id,
        rv.is_active,
        rv.review_status,
        fa.response_type,
        MAX(CASE WHEN fa.applicant_type = 'natural_person' THEN fa.count END) AS natural_person,
        MAX(CASE WHEN fa.applicant_type = 'legal_person_commercial' THEN fa.count END) AS legal_person_commercial,
        MAX(CASE WHEN fa.applicant_type = 'legal_person_research' THEN fa.count END) AS legal_person_research,
        MAX(CASE WHEN fa.applicant_type = 'legal_person_social' THEN fa.count END) AS legal_person_social,
        MAX(CASE WHEN fa.applicant_type = 'legal_person_legal' THEN fa.count END) AS legal_person_legal,
        MAX(CASE WHEN fa.applicant_type = 'legal_person_other' THEN fa.count END) AS legal_person_other,
        MAX(CASE WHEN fa.applicant_type = 'total' THEN fa.count END) AS total
      FROM report_versions rv
      JOIN fact_application fa
        ON fa.version_id = rv.id
       AND fa.report_id = rv.report_id
      ${activeFilter}
      GROUP BY rv.report_id, rv.id, rv.is_active, rv.review_status, fa.response_type
    )
    SELECT *
    FROM base
    WHERE total IS NOT NULL
    ORDER BY version_id DESC, response_type ASC
  `;

  const result = await pool.query(query);
  return result.rows as RowAggregate[];
}

function buildSuspiciousRows(rows: RowAggregate[]): SuspiciousRow[] {
  const suspiciousRows: SuspiciousRow[] = [];

  rows.forEach((row) => {
    const candidates = findCandidates(row);
    if (candidates.length === 0) {
      return;
    }

    const entitySum = ENTITY_KEYS.reduce((acc, key) => acc + toNumber(row[key]), 0);
    const total = toNumber(row.total);
    suspiciousRows.push({
      report_id: row.report_id,
      version_id: row.version_id,
      is_active: row.is_active,
      review_status: row.review_status,
      response_type: row.response_type,
      total,
      entity_sum: entitySum,
      delta: total - entitySum,
      candidates,
    });
  });

  return suspiciousRows;
}

async function main() {
  const { activeOnly, json, limit } = parseArgs(process.argv.slice(2));

  const rows = await loadRows(activeOnly);
  const suspiciousRows = buildSuspiciousRows(rows);
  const summary = {
    rows_scanned: rows.length,
    suspicious_rows: suspiciousRows.length,
    suspicious_reports: new Set(suspiciousRows.map((row) => row.report_id)).size,
    suspicious_versions: new Set(suspiciousRows.map((row) => row.version_id)).size,
    active_only: activeOnly,
  };

  if (json) {
    console.log(
      JSON.stringify(
        {
          summary,
          samples: suspiciousRows.slice(0, limit),
        },
        null,
        2
      )
    );
    return;
  }

  console.log('Table3 fragmentation scan');
  console.log(JSON.stringify(summary, null, 2));
  console.log('');
  suspiciousRows.slice(0, limit).forEach((row, index) => {
    const candidateText = row.candidates
      .map((candidate) => `${candidate.left_key}=${candidate.left_value} + ${candidate.right_key}=${candidate.right_value} -> ${candidate.merged_value}`)
      .join(' | ');
    console.log(
      `${index + 1}. report=${row.report_id} version=${row.version_id} response=${row.response_type} sum=${row.entity_sum} total=${row.total} delta=${row.delta} candidates=${candidateText}`
    );
  });
}

main()
  .catch((error) => {
    console.error('[scan-table3-fragmentation] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
