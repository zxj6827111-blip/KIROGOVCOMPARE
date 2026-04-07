const ENTITY_DEFINITIONS = [
  { key: 'naturalPerson', label: 'Natural Person', dataPath: ['naturalPerson'], fullPath: 'naturalPerson' },
  {
    key: 'commercial',
    label: 'Commercial Org',
    dataPath: ['legalPerson', 'commercial'],
    fullPath: 'legalPerson.commercial',
  },
  {
    key: 'research',
    label: 'Research Org',
    dataPath: ['legalPerson', 'research'],
    fullPath: 'legalPerson.research',
  },
  { key: 'social', label: 'Social Org', dataPath: ['legalPerson', 'social'], fullPath: 'legalPerson.social' },
  { key: 'legal', label: 'Legal Service', dataPath: ['legalPerson', 'legal'], fullPath: 'legalPerson.legal' },
  { key: 'other', label: 'Other Org', dataPath: ['legalPerson', 'other'], fullPath: 'legalPerson.other' },
  { key: 'total', label: 'Total', dataPath: ['total'], fullPath: 'total' },
];

const ROW_DEFINITIONS = [
  { fieldPath: 'newReceived', label: 'New Received' },
  { fieldPath: 'carriedOver', label: 'Carried Over' },
  { fieldPath: 'results.granted', label: 'Granted' },
  { fieldPath: 'results.partialGrant', label: 'Partial Grant' },
  { fieldPath: 'results.denied.stateSecret', label: 'Denied: State Secret' },
  { fieldPath: 'results.denied.lawForbidden', label: 'Denied: Law Forbidden' },
  { fieldPath: 'results.denied.safetyStability', label: 'Denied: Safety/Stability' },
  { fieldPath: 'results.denied.thirdPartyRights', label: 'Denied: Third-Party Rights' },
  { fieldPath: 'results.denied.internalAffairs', label: 'Denied: Internal Affairs' },
  { fieldPath: 'results.denied.processInfo', label: 'Denied: Process Info' },
  { fieldPath: 'results.denied.enforcementCase', label: 'Denied: Enforcement Case' },
  { fieldPath: 'results.denied.adminQuery', label: 'Denied: Admin Query' },
  { fieldPath: 'results.unableToProvide.noInfo', label: 'Unable: No Info' },
  { fieldPath: 'results.unableToProvide.needCreation', label: 'Unable: Need Creation' },
  { fieldPath: 'results.unableToProvide.unclear', label: 'Unable: Unclear Request' },
  { fieldPath: 'results.notProcessed.complaint', label: 'Not Processed: Complaint' },
  { fieldPath: 'results.notProcessed.repeat', label: 'Not Processed: Repeat' },
  { fieldPath: 'results.notProcessed.publication', label: 'Not Processed: Publication' },
  { fieldPath: 'results.notProcessed.massiveRequests', label: 'Not Processed: Massive Requests' },
  { fieldPath: 'results.notProcessed.confirmInfo', label: 'Not Processed: Confirm Info' },
  { fieldPath: 'results.other.overdueCorrection', label: 'Other: Overdue Correction' },
  { fieldPath: 'results.other.overdueFee', label: 'Other: Overdue Fee' },
  { fieldPath: 'results.other.otherReasons', label: 'Other: Other Reasons' },
  { fieldPath: 'results.totalProcessed', label: 'Total Processed' },
  { fieldPath: 'results.carriedForward', label: 'Carried Forward' },
];

const NON_TOTAL_ENTITIES = ENTITY_DEFINITIONS.filter((entity) => entity.key !== 'total');

const readPath = (source, path) =>
  path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), source);

const toNumberValue = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const isSingleDigitInteger = (value) => Number.isInteger(value) && value >= 0 && value <= 9;

const buildMergedValue = (leftValue, rightValue) => Number(`${leftValue}${rightValue}`);

export function analyzeTable3Diagnostics(data) {
  const suspiciousByPath = new Map();
  const suspiciousRows = [];
  const identityRows = [];

  if (!data || typeof data !== 'object') {
    return { suspiciousRows, identityRows, suspiciousByPath };
  }

  ROW_DEFINITIONS.forEach((rowDef) => {
    const entries = ENTITY_DEFINITIONS.map((entity) => ({
      ...entity,
      value: toNumberValue(readPath(data, [...entity.dataPath, ...rowDef.fieldPath.split('.')])),
    }));

    const totalEntry = entries.find((entity) => entity.key === 'total');
    if (!totalEntry) return;

    const total = totalEntry.value;
    const sum = NON_TOTAL_ENTITIES.reduce((acc, entity) => {
      const current = entries.find((entry) => entry.key === entity.key);
      return acc + (current ? current.value : 0);
    }, 0);

    if (sum === total) return;

    const candidates = [];
    for (let i = 0; i < NON_TOTAL_ENTITIES.length - 1; i += 1) {
      const left = entries.find((entry) => entry.key === NON_TOTAL_ENTITIES[i].key);
      const right = entries.find((entry) => entry.key === NON_TOTAL_ENTITIES[i + 1].key);
      if (!left || !right) continue;
      if (!isSingleDigitInteger(left.value) || !isSingleDigitInteger(right.value)) continue;
      if (left.value === 0 && right.value === 0) continue;

      const mergedValue = buildMergedValue(left.value, right.value);
      const repairedSum = sum - left.value - right.value + mergedValue;
      if (repairedSum !== total) continue;

      candidates.push({
        left,
        right,
        mergedValue,
      });
    }

    if (candidates.length === 0) return;

    const candidateLabels = candidates.map(
      (candidate) =>
        `${candidate.left.label}=${candidate.left.value} + ${candidate.right.label}=${candidate.right.value} -> ${candidate.mergedValue}`
    );
    const message = `${rowDef.label} sum=${sum}, total=${total}. Adjacent single digits may belong together; verify against the source.`;
    const title = `${message} Candidates: ${candidateLabels.join(' | ')}`;

    suspiciousRows.push({
      key: rowDef.fieldPath,
      rowLabel: rowDef.label,
      total,
      sum,
      delta: total - sum,
      message,
      title,
      candidates: candidates.map((candidate) => ({
        leftLabel: candidate.left.label,
        rightLabel: candidate.right.label,
        leftValue: candidate.left.value,
        rightValue: candidate.right.value,
        mergedValue: candidate.mergedValue,
        leftPath: `tableData.${candidate.left.fullPath}.${rowDef.fieldPath}`,
        rightPath: `tableData.${candidate.right.fullPath}.${rowDef.fieldPath}`,
      })),
    });

    candidates.forEach((candidate) => {
      const affectedPaths = [
        `tableData.${candidate.left.fullPath}.${rowDef.fieldPath}`,
        `tableData.${candidate.right.fullPath}.${rowDef.fieldPath}`,
      ];
      affectedPaths.forEach((path) => {
        suspiciousByPath.set(path, {
          rowLabel: rowDef.label,
          title,
          marker: 'Split?',
        });
      });
    });
  });

  ENTITY_DEFINITIONS.forEach((entity) => {
    const basePath = `tableData.${entity.fullPath}`;
    const newReceived = toNumberValue(readPath(data, [...entity.dataPath, 'newReceived']));
    const carriedOver = toNumberValue(readPath(data, [...entity.dataPath, 'carriedOver']));
    const totalProcessed = toNumberValue(readPath(data, [...entity.dataPath, 'results', 'totalProcessed']));
    const carriedForward = toNumberValue(readPath(data, [...entity.dataPath, 'results', 'carriedForward']));

    const incoming = newReceived + carriedOver;
    const outgoing = totalProcessed + carriedForward;
    if (incoming === outgoing) return;

    const rowLabel = `${entity.label} row`;
    const message = `${rowLabel} identity mismatch: new+carry=${incoming}, processed+forward=${outgoing}. Check for split cells or misplaced values.`;
    const title = `${message} Current values: new=${newReceived}, carry=${carriedOver}, processed=${totalProcessed}, forward=${carriedForward}`;
    const affectedPaths = [
      `${basePath}.newReceived`,
      `${basePath}.carriedOver`,
      `${basePath}.results.totalProcessed`,
      `${basePath}.results.carriedForward`,
    ];

    identityRows.push({
      key: `${entity.fullPath}_identity`,
      rowLabel,
      incoming,
      outgoing,
      delta: incoming - outgoing,
      message,
      title,
      paths: affectedPaths,
    });

    affectedPaths.forEach((path) => {
      if (suspiciousByPath.has(path)) return;
      suspiciousByPath.set(path, {
        rowLabel,
        title,
        marker: 'Mismatch',
      });
    });
  });

  return { suspiciousRows, identityRows, suspiciousByPath };
}

export function getTable3SuspiciousCell(diagnostics, fullPath) {
  if (!diagnostics || !fullPath) return null;
  return diagnostics.suspiciousByPath.get(fullPath) || null;
}
