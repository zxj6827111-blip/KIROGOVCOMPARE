type AnyRecord = Record<string, any>;

export interface ParsedOutputStabilizeOptions {
  table3?: boolean;
  table4?: boolean;
}

function toFiniteNumber(value: any): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === '/' || trimmed === '-' || trimmed === '--' || trimmed === '—') return null;
  const normalized = trimmed.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectStrictNumbers(paths: string[], source: AnyRecord): { values: number[]; ok: boolean } {
  const values: number[] = [];
  for (const path of paths) {
    const segments = path.split('.');
    let current: any = source;
    for (const seg of segments) {
      current = current?.[seg];
    }
    const value = toFiniteNumber(current);
    if (value === null) {
      return { values: [], ok: false };
    }
    values.push(value);
  }
  return { values, ok: true };
}

function assignIfChanged(target: AnyRecord, key: string, nextValue: number, repairTag: string, repairs: string[]): void {
  const current = toFiniteNumber(target?.[key]);
  if (current === null || current !== nextValue) {
    target[key] = nextValue;
    repairs.push(repairTag);
  }
}

function readNumericByPath(source: AnyRecord, path: string): number | null {
  const segments = path.split('.');
  let current: any = source;
  for (const seg of segments) {
    current = current?.[seg];
  }
  return toFiniteNumber(current);
}

function ensureObjectPath(target: AnyRecord, pathSegments: string[]): AnyRecord | null {
  let current: any = target;
  for (const seg of pathSegments) {
    if (!current || typeof current !== 'object') {
      return null;
    }
    if (!current[seg] || typeof current[seg] !== 'object') {
      current[seg] = {};
    }
    current = current[seg];
  }
  return current && typeof current === 'object' ? current : null;
}

function computeTable3IdentityTotal(node: AnyRecord | undefined): number | null {
  const newReceived = readNumericByPath(node || {}, 'newReceived');
  const carriedOver = readNumericByPath(node || {}, 'carriedOver');
  const carriedForward = readNumericByPath(node || {}, 'results.carriedForward');
  if (newReceived === null || carriedOver === null || carriedForward === null) {
    return null;
  }
  return newReceived + carriedOver - carriedForward;
}

function stabilizeTable3(tableData: AnyRecord, repairs: string[]): void {
  const entityMap: Array<{ path: string; node: AnyRecord | undefined }> = [
    { path: 'naturalPerson', node: tableData?.naturalPerson },
    { path: 'legalPerson.commercial', node: tableData?.legalPerson?.commercial },
    { path: 'legalPerson.research', node: tableData?.legalPerson?.research },
    { path: 'legalPerson.social', node: tableData?.legalPerson?.social },
    { path: 'legalPerson.legal', node: tableData?.legalPerson?.legal },
    { path: 'legalPerson.other', node: tableData?.legalPerson?.other },
    { path: 'total', node: tableData?.total },
  ];

  const totalProcessedBreakdownPaths = [
    'granted',
    'partialGrant',
    'denied.stateSecret',
    'denied.lawForbidden',
    'denied.safetyStability',
    'denied.thirdPartyRights',
    'denied.internalAffairs',
    'denied.processInfo',
    'denied.enforcementCase',
    'denied.adminQuery',
    'unableToProvide.noInfo',
    'unableToProvide.needCreation',
    'unableToProvide.unclear',
    'notProcessed.complaint',
    'notProcessed.repeat',
    'notProcessed.publication',
    'notProcessed.massiveRequests',
    'notProcessed.confirmInfo',
    'other.overdueCorrection',
    'other.overdueFee',
    'other.otherReasons',
  ];

  for (const entity of entityMap) {
    const results = entity.node?.results;
    if (!results || typeof results !== 'object') {
      continue;
    }

    const breakdown = collectStrictNumbers(totalProcessedBreakdownPaths, results);
    if (breakdown.ok) {
      const computedTotal = breakdown.values.reduce((sum, n) => sum + n, 0);
      const currentTotal = toFiniteNumber(results.totalProcessed);
      const identityTotal = computeTable3IdentityTotal(entity.node);

      // Be conservative here: some parses contain a stray detailed bucket that would
      // inflate totalProcessed if we always recompute it from the breakdown.
      if (currentTotal === null) {
        if (identityTotal === null || computedTotal === identityTotal) {
          assignIfChanged(
            results,
            'totalProcessed',
            computedTotal,
            `table_3.${entity.path}.results.totalProcessed`,
            repairs
          );
        }
        continue;
      }

      if (identityTotal !== null) {
        if (currentTotal === identityTotal) {
          continue;
        }
        if (computedTotal === identityTotal) {
          assignIfChanged(
            results,
            'totalProcessed',
            identityTotal,
            `table_3.${entity.path}.results.totalProcessed`,
            repairs
          );
        }
        continue;
      }

      if (currentTotal === 0 && computedTotal > 0) {
        assignIfChanged(
          results,
          'totalProcessed',
          computedTotal,
          `table_3.${entity.path}.results.totalProcessed`,
          repairs
        );
      }
    }
  }

  // Stabilize total row from applicant sub-rows.
  const subEntities: AnyRecord[] = [
    tableData?.naturalPerson,
    tableData?.legalPerson?.commercial,
    tableData?.legalPerson?.research,
    tableData?.legalPerson?.social,
    tableData?.legalPerson?.legal,
    tableData?.legalPerson?.other,
  ].filter(Boolean);

  if (tableData?.total && typeof tableData.total === 'object' && subEntities.length === 6) {
    const fields = [
      { path: 'newReceived', label: 'newReceived' },
      { path: 'carriedOver', label: 'carriedOver' },
      { path: 'results.granted', label: 'results.granted' },
      { path: 'results.partialGrant', label: 'results.partialGrant' },
      { path: 'results.denied.stateSecret', label: 'results.denied.stateSecret' },
      { path: 'results.denied.lawForbidden', label: 'results.denied.lawForbidden' },
      { path: 'results.denied.safetyStability', label: 'results.denied.safetyStability' },
      { path: 'results.denied.thirdPartyRights', label: 'results.denied.thirdPartyRights' },
      { path: 'results.denied.internalAffairs', label: 'results.denied.internalAffairs' },
      { path: 'results.denied.processInfo', label: 'results.denied.processInfo' },
      { path: 'results.denied.enforcementCase', label: 'results.denied.enforcementCase' },
      { path: 'results.denied.adminQuery', label: 'results.denied.adminQuery' },
      { path: 'results.unableToProvide.noInfo', label: 'results.unableToProvide.noInfo' },
      { path: 'results.unableToProvide.needCreation', label: 'results.unableToProvide.needCreation' },
      { path: 'results.unableToProvide.unclear', label: 'results.unableToProvide.unclear' },
      { path: 'results.notProcessed.complaint', label: 'results.notProcessed.complaint' },
      { path: 'results.notProcessed.repeat', label: 'results.notProcessed.repeat' },
      { path: 'results.notProcessed.publication', label: 'results.notProcessed.publication' },
      { path: 'results.notProcessed.massiveRequests', label: 'results.notProcessed.massiveRequests' },
      { path: 'results.notProcessed.confirmInfo', label: 'results.notProcessed.confirmInfo' },
      { path: 'results.other.overdueCorrection', label: 'results.other.overdueCorrection' },
      { path: 'results.other.overdueFee', label: 'results.other.overdueFee' },
      { path: 'results.other.otherReasons', label: 'results.other.otherReasons' },
      { path: 'results.totalProcessed', label: 'results.totalProcessed' },
      { path: 'results.carriedForward', label: 'results.carriedForward' },
    ];

    for (const field of fields) {
      const values: number[] = [];
      let allNumeric = true;
      for (const entity of subEntities) {
        const value = readNumericByPath(entity, field.path);
        if (value === null) {
          allNumeric = false;
          break;
        }
        values.push(value);
      }

      if (!allNumeric) {
        continue;
      }

      const computed = values.reduce((sum, n) => sum + n, 0);
      if (!field.path.includes('.')) {
        assignIfChanged(tableData.total, field.path, computed, `table_3.total.${field.label}`, repairs);
        continue;
      }

      const segments = field.path.split('.');
      const parent = ensureObjectPath(tableData.total, segments.slice(0, -1));
      const leafKey = segments[segments.length - 1];
      if (parent && leafKey) {
        assignIfChanged(parent, leafKey, computed, `table_3.total.${field.label}`, repairs);
      }
    }
  }
}

function stabilizeTable4(reviewLitigationData: AnyRecord, repairs: string[]): void {
  const blocks = ['review', 'litigationDirect', 'litigationPostReview'];
  for (const block of blocks) {
    const node = reviewLitigationData?.[block];
    if (!node || typeof node !== 'object') {
      continue;
    }
    const values = collectStrictNumbers(['maintain', 'correct', 'other', 'unfinished'], node);
    if (!values.ok) {
      continue;
    }
    const computed = values.values.reduce((sum, n) => sum + n, 0);
    assignIfChanged(node, 'total', computed, `table_4.${block}.total`, repairs);
  }
}

export function stabilizeParsedOutput<T>(
  output: T,
  userOptions?: ParsedOutputStabilizeOptions
): { output: T; repairs: string[] } {
  const repairs: string[] = [];
  if (!output || typeof output !== 'object') {
    return { output, repairs };
  }

  const options: Required<ParsedOutputStabilizeOptions> = {
    table3: true,
    table4: true,
    ...(userOptions || {}),
  };

  const parsed = output as AnyRecord;
  const sections = Array.isArray(parsed.sections) ? parsed.sections : [];

  for (const section of sections) {
    if (!section || typeof section !== 'object') {
      continue;
    }

    if (
      options.table3 &&
      section.type === 'table_3' &&
      section.tableData &&
      typeof section.tableData === 'object'
    ) {
      stabilizeTable3(section.tableData as AnyRecord, repairs);
    }

    if (
      options.table4 &&
      section.type === 'table_4' &&
      section.reviewLitigationData &&
      typeof section.reviewLitigationData === 'object'
    ) {
      stabilizeTable4(section.reviewLitigationData as AnyRecord, repairs);
    }
  }

  return { output, repairs };
}
