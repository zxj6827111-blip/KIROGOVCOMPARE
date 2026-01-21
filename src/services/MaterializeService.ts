import pool from '../config/database-llm';

interface MaterializeInput {
  reportId: number;
  versionId: number;
  parsedJson: string | Record<string, any>;
}

type ValueSemantic = 'ZERO' | 'EMPTY' | 'NA' | 'TEXT' | 'NUMERIC';

interface CellRecord {
  table_id: string;
  row_key: string;
  col_key: string;
  cell_ref: string;
  value_raw: string | null;
  value_num: number | null;
  value_semantic: ValueSemantic;
  normalized_value: string | null;
}

interface FactActiveDisclosure {
  category: string;
  made_count: number | null;
  repealed_count: number | null;
  valid_count: number | null;
  processed_count: number | null;
  amount: number | null;
}

interface FactApplication {
  applicant_type: string;
  response_type: string;
  count: number | null;
}

interface FactLegalProceeding {
  case_type: string;
  result_type: string;
  count: number | null;
}

function parseJson(input: string | Record<string, any>): any {
  if (input === null || input === undefined) {
    return null;
  }
  if (typeof input === 'object') {
    return input;
  }
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function normalizeValue(value: any): { raw: string | null; num: number | null; semantic: ValueSemantic; normalized: string | null } {
  if (value === null || value === undefined || value === '') {
    return { raw: value === '' ? '' : null, num: null, semantic: 'EMPTY', normalized: null };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '/' || trimmed === '-' || trimmed === '—') {
      return { raw: value, num: null, semantic: 'NA', normalized: trimmed };
    }
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
      if (numeric === 0) {
        return { raw: value, num: 0, semantic: 'ZERO', normalized: String(numeric) };
      }
      return { raw: value, num: numeric, semantic: 'NUMERIC', normalized: String(numeric) };
    }
    return { raw: value, num: null, semantic: 'TEXT', normalized: trimmed };
  }

  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return { raw: String(value), num: null, semantic: 'TEXT', normalized: String(value) };
    }
    if (value === 0) {
      return { raw: '0', num: 0, semantic: 'ZERO', normalized: '0' };
    }
    return { raw: String(value), num: value, semantic: 'NUMERIC', normalized: String(value) };
  }

  return { raw: String(value), num: null, semantic: 'TEXT', normalized: String(value) };
}

function coerceNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '/' || trimmed === '-' || trimmed === '—') {
      return null;
    }
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function getSection(parsed: any, type: string): any {
  const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  return sections.find((section: any) => section?.type === type);
}

function getNested(obj: any, path: string[]): any {
  return path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function buildCell(tableId: string, rowKey: string, colKey: string, value: any): CellRecord {
  const normalized = normalizeValue(value);
  return {
    table_id: tableId,
    row_key: rowKey,
    col_key: colKey,
    cell_ref: `${tableId}:${rowKey}:${colKey}`,
    value_raw: normalized.raw,
    value_num: normalized.num,
    value_semantic: normalized.semantic,
    normalized_value: normalized.normalized,
  };
}

function buildActiveDisclosure(parsed: any): { facts: FactActiveDisclosure[]; cells: CellRecord[] } {
  const section = getSection(parsed, 'table_2');
  const data = section?.activeDisclosureData || parsed?.activeDisclosureData || {};

  const mapping = [
    { key: 'regulations', category: 'regulations', fields: { made: 'made_count', repealed: 'repealed_count', valid: 'valid_count' } },
    { key: 'normativeDocuments', category: 'normative_documents', fields: { made: 'made_count', repealed: 'repealed_count', valid: 'valid_count' } },
    { key: 'licensing', category: 'licensing', fields: { processed: 'processed_count' } },
    { key: 'punishment', category: 'punishment', fields: { processed: 'processed_count' } },
    { key: 'coercion', category: 'coercion', fields: { processed: 'processed_count' } },
    { key: 'fees', category: 'fees', fields: { amount: 'amount' } },
  ];

  const facts: FactActiveDisclosure[] = [];
  const cells: CellRecord[] = [];

  mapping.forEach(({ key, category, fields }) => {
    const entry = data?.[key];
    if (!entry) {
      return;
    }

    const fact: FactActiveDisclosure = {
      category,
      made_count: null,
      repealed_count: null,
      valid_count: null,
      processed_count: null,
      amount: null,
    };

    Object.entries(fields).forEach(([fieldKey, column]) => {
      const value = entry[fieldKey];
      cells.push(buildCell('active_disclosure', category, fieldKey, value));
      const numeric = coerceNumber(value);
      (fact as any)[column] = numeric;
    });

    facts.push(fact);
  });

  return { facts, cells };
}

function buildApplication(parsed: any): { facts: FactApplication[]; cells: CellRecord[] } {
  const section = getSection(parsed, 'table_3');
  const data = section?.tableData || parsed?.tableData || {};

  const applicantMap = [
    { key: ['naturalPerson'], label: 'natural_person' },
    { key: ['legalPerson', 'commercial'], label: 'legal_person_commercial' },
    { key: ['legalPerson', 'research'], label: 'legal_person_research' },
    { key: ['legalPerson', 'social'], label: 'legal_person_social' },
    { key: ['legalPerson', 'legal'], label: 'legal_person_legal' },
    { key: ['legalPerson', 'other'], label: 'legal_person_other' },
    { key: ['total'], label: 'total' },
  ];

  const responseMap: Array<{ key: string; path: string[] }> = [
    { key: 'new_received', path: ['newReceived'] },
    { key: 'carried_over', path: ['carriedOver'] },
    { key: 'granted', path: ['results', 'granted'] },
    { key: 'partial_grant', path: ['results', 'partialGrant'] },
    { key: 'denied_state_secret', path: ['results', 'denied', 'stateSecret'] },
    { key: 'denied_law_forbidden', path: ['results', 'denied', 'lawForbidden'] },
    { key: 'denied_safety_stability', path: ['results', 'denied', 'safetyStability'] },
    { key: 'denied_third_party_rights', path: ['results', 'denied', 'thirdPartyRights'] },
    { key: 'denied_internal_affairs', path: ['results', 'denied', 'internalAffairs'] },
    { key: 'denied_process_info', path: ['results', 'denied', 'processInfo'] },
    { key: 'denied_enforcement_case', path: ['results', 'denied', 'enforcementCase'] },
    { key: 'denied_admin_query', path: ['results', 'denied', 'adminQuery'] },
    { key: 'unable_no_info', path: ['results', 'unableToProvide', 'noInfo'] },
    { key: 'unable_need_creation', path: ['results', 'unableToProvide', 'needCreation'] },
    { key: 'unable_unclear', path: ['results', 'unableToProvide', 'unclear'] },
    { key: 'not_processed_complaint', path: ['results', 'notProcessed', 'complaint'] },
    { key: 'not_processed_repeat', path: ['results', 'notProcessed', 'repeat'] },
    { key: 'not_processed_publication', path: ['results', 'notProcessed', 'publication'] },
    { key: 'not_processed_massive_requests', path: ['results', 'notProcessed', 'massiveRequests'] },
    { key: 'not_processed_confirm_info', path: ['results', 'notProcessed', 'confirmInfo'] },
    { key: 'other_overdue_correction', path: ['results', 'other', 'overdueCorrection'] },
    { key: 'other_overdue_fee', path: ['results', 'other', 'overdueFee'] },
    { key: 'other_other_reasons', path: ['results', 'other', 'otherReasons'] },
    { key: 'total_processed', path: ['results', 'totalProcessed'] },
    { key: 'carried_forward', path: ['results', 'carriedForward'] },
  ];

  const facts: FactApplication[] = [];
  const cells: CellRecord[] = [];

  applicantMap.forEach((applicant) => {
    const applicantData = getNested(data, applicant.key);
    if (!applicantData) {
      return;
    }

    responseMap.forEach((response) => {
      const value = getNested(applicantData, response.path);
      cells.push(buildCell('application', response.key, applicant.label, value));
      facts.push({
        applicant_type: applicant.label,
        response_type: response.key,
        count: coerceNumber(value),
      });
    });
  });

  return { facts, cells };
}

function buildLegalProceeding(parsed: any): { facts: FactLegalProceeding[]; cells: CellRecord[] } {
  const section = getSection(parsed, 'table_4');
  const data = section?.reviewLitigationData || parsed?.reviewLitigationData || {};

  const caseMap = [
    { key: 'review', label: 'review' },
    { key: 'litigationDirect', label: 'litigation_direct' },
    { key: 'litigationPostReview', label: 'litigation_post_review' },
  ];

  const resultMap = [
    { key: 'maintain', label: 'maintain' },
    { key: 'correct', label: 'correct' },
    { key: 'other', label: 'other' },
    { key: 'unfinished', label: 'unfinished' },
    { key: 'total', label: 'total' },
  ];

  const facts: FactLegalProceeding[] = [];
  const cells: CellRecord[] = [];

  caseMap.forEach((caseItem) => {
    const caseData = data?.[caseItem.key];
    if (!caseData) {
      return;
    }

    resultMap.forEach((result) => {
      const value = caseData[result.key];
      cells.push(buildCell('legal_proceeding', caseItem.label, result.label, value));
      facts.push({
        case_type: caseItem.label,
        result_type: result.label,
        count: coerceNumber(value),
      });
    });
  });

  return { facts, cells };
}

export async function materializeReportVersion(input: MaterializeInput): Promise<void> {
  const parsed = parseJson(input.parsedJson);
  if (!parsed) {
    throw new Error('parsed_json_invalid');
  }

  const activeDisclosure = buildActiveDisclosure(parsed);
  const application = buildApplication(parsed);
  const legal = buildLegalProceeding(parsed);

  const cells = [...activeDisclosure.cells, ...application.cells, ...legal.cells];

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Delete existing data
    await client.query('DELETE FROM cells WHERE version_id = $1', [input.versionId]);
    await client.query('DELETE FROM fact_active_disclosure WHERE version_id = $1', [input.versionId]);
    await client.query('DELETE FROM fact_application WHERE version_id = $1', [input.versionId]);
    await client.query('DELETE FROM fact_legal_proceeding WHERE version_id = $1', [input.versionId]);

    // Insert active disclosure facts
    for (const fact of activeDisclosure.facts) {
      await client.query(
        `INSERT INTO fact_active_disclosure (report_id, version_id, category, made_count, repealed_count, valid_count, processed_count, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [input.reportId, input.versionId, fact.category, fact.made_count, fact.repealed_count, fact.valid_count, fact.processed_count, fact.amount]
      );
    }

    // Insert application facts
    for (const fact of application.facts) {
      await client.query(
        `INSERT INTO fact_application (report_id, version_id, applicant_type, response_type, count)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.reportId, input.versionId, fact.applicant_type, fact.response_type, fact.count]
      );
    }

    // Insert legal proceeding facts
    for (const fact of legal.facts) {
      await client.query(
        `INSERT INTO fact_legal_proceeding (report_id, version_id, case_type, result_type, count)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.reportId, input.versionId, fact.case_type, fact.result_type, fact.count]
      );
    }

    // Insert cells
    for (const cell of cells) {
      await client.query(
        `INSERT INTO cells (version_id, table_id, row_key, col_key, cell_ref, value_raw, value_num, value_semantic, normalized_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [input.versionId, cell.table_id, cell.row_key, cell.col_key, cell.cell_ref, cell.value_raw, cell.value_num, cell.value_semantic, cell.normalized_value]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
