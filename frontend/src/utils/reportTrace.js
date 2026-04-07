import { analyzeTable3Diagnostics } from './table3Diagnostics';

const APPLICANT_COLUMNS = [
  {
    key: 'naturalPerson',
    label: '自然人',
    dataPath: ['naturalPerson'],
    factKey: 'natural_person',
    fullPath: 'naturalPerson',
  },
  {
    key: 'commercial',
    label: '商业企业',
    dataPath: ['legalPerson', 'commercial'],
    factKey: 'legal_person_commercial',
    fullPath: 'legalPerson.commercial',
  },
  {
    key: 'research',
    label: '科研机构',
    dataPath: ['legalPerson', 'research'],
    factKey: 'legal_person_research',
    fullPath: 'legalPerson.research',
  },
  {
    key: 'social',
    label: '社会公益组织',
    dataPath: ['legalPerson', 'social'],
    factKey: 'legal_person_social',
    fullPath: 'legalPerson.social',
  },
  {
    key: 'legal',
    label: '法律服务机构',
    dataPath: ['legalPerson', 'legal'],
    factKey: 'legal_person_legal',
    fullPath: 'legalPerson.legal',
  },
  {
    key: 'other',
    label: '其他',
    dataPath: ['legalPerson', 'other'],
    factKey: 'legal_person_other',
    fullPath: 'legalPerson.other',
  },
  {
    key: 'total',
    label: '总计',
    dataPath: ['total'],
    factKey: 'total',
    fullPath: 'total',
  },
];

const RESPONSE_ROWS = [
  {
    factKey: 'new_received',
    fieldPath: 'newReceived',
    label: '本年新收政府信息公开申请数量',
    searchTerms: ['本年新收政府信息', '本年新收'],
  },
  {
    factKey: 'carried_over',
    fieldPath: 'carriedOver',
    label: '上年结转政府信息公开申请数量',
    searchTerms: ['上年结转政府信息', '上年结转'],
  },
  { factKey: 'granted', fieldPath: 'results.granted', label: '予以公开', searchTerms: ['予以公开'] },
  {
    factKey: 'partial_grant',
    fieldPath: 'results.partialGrant',
    label: '部分公开',
    searchTerms: ['部分公开'],
  },
  {
    factKey: 'denied_state_secret',
    fieldPath: 'results.denied.stateSecret',
    label: '不予公开：属于国家秘密',
    searchTerms: ['属于国家秘密'],
  },
  {
    factKey: 'denied_law_forbidden',
    fieldPath: 'results.denied.lawForbidden',
    label: '不予公开：其他法律行政法规禁止公开',
    searchTerms: ['禁止公开'],
  },
  {
    factKey: 'denied_safety_stability',
    fieldPath: 'results.denied.safetyStability',
    label: '不予公开：危及国家安全、公共安全、经济安全和社会稳定',
    searchTerms: ['危及国家安全', '社会稳定'],
  },
  {
    factKey: 'denied_third_party_rights',
    fieldPath: 'results.denied.thirdPartyRights',
    label: '不予公开：保护第三方合法权益',
    searchTerms: ['第三方合法权益'],
  },
  {
    factKey: 'denied_internal_affairs',
    fieldPath: 'results.denied.internalAffairs',
    label: '不予公开：属于三类内部事务信息',
    searchTerms: ['内部事务信息'],
  },
  {
    factKey: 'denied_process_info',
    fieldPath: 'results.denied.processInfo',
    label: '不予公开：属于四类过程性信息',
    searchTerms: ['过程性信息'],
  },
  {
    factKey: 'denied_enforcement_case',
    fieldPath: 'results.denied.enforcementCase',
    label: '不予公开：属于行政执法案卷',
    searchTerms: ['行政执法案卷'],
  },
  {
    factKey: 'denied_admin_query',
    fieldPath: 'results.denied.adminQuery',
    label: '不予公开：属于行政查询事项',
    searchTerms: ['行政查询事项'],
  },
  {
    factKey: 'unable_no_info',
    fieldPath: 'results.unableToProvide.noInfo',
    label: '无法提供：本机关不掌握相关政府信息',
    searchTerms: ['不掌握相关政府信息'],
  },
  {
    factKey: 'unable_need_creation',
    fieldPath: 'results.unableToProvide.needCreation',
    label: '无法提供：没有现成信息需要另行制作',
    searchTerms: ['另行制作', '没有现成信息'],
  },
  {
    factKey: 'unable_unclear',
    fieldPath: 'results.unableToProvide.unclear',
    label: '无法提供：补正后申请内容仍不明确',
    searchTerms: ['申请内容仍不明确', '补正后'],
  },
  {
    factKey: 'not_processed_complaint',
    fieldPath: 'results.notProcessed.complaint',
    label: '不予处理：信访举报投诉类申请',
    searchTerms: ['信访举报投诉'],
  },
  {
    factKey: 'not_processed_repeat',
    fieldPath: 'results.notProcessed.repeat',
    label: '不予处理：重复申请',
    searchTerms: ['重复申请'],
  },
  {
    factKey: 'not_processed_publication',
    fieldPath: 'results.notProcessed.publication',
    label: '不予处理：要求提供公开出版物',
    searchTerms: ['公开出版物'],
  },
  {
    factKey: 'not_processed_massive_requests',
    fieldPath: 'results.notProcessed.massiveRequests',
    label: '不予处理：无正当理由大量反复申请',
    searchTerms: ['大量反复申请'],
  },
  {
    factKey: 'not_processed_confirm_info',
    fieldPath: 'results.notProcessed.confirmInfo',
    label: '不予处理：要求行政机关确认或重新出具已获取信息',
    searchTerms: ['确认或重新出具', '已获取信息'],
  },
  {
    factKey: 'other_overdue_correction',
    fieldPath: 'results.other.overdueCorrection',
    label: '其他处理：逾期不补正',
    searchTerms: ['逾期不补正'],
  },
  {
    factKey: 'other_overdue_fee',
    fieldPath: 'results.other.overdueFee',
    label: '其他处理：逾期不缴费',
    searchTerms: ['逾期不缴费'],
  },
  {
    factKey: 'other_other_reasons',
    fieldPath: 'results.other.otherReasons',
    label: '其他处理：其他',
    searchTerms: ['其他处理'],
  },
  {
    factKey: 'total_processed',
    fieldPath: 'results.totalProcessed',
    label: '总计',
    searchTerms: ['总计'],
  },
  {
    factKey: 'carried_forward',
    fieldPath: 'results.carriedForward',
    label: '结转下年度继续办理',
    searchTerms: ['结转下年度继续办理', '继续办理'],
  },
];

const APPLICANT_INDEX = new Map(APPLICANT_COLUMNS.map((column, index) => [column.factKey, index]));
const RESPONSE_ROW_MAP = new Map(RESPONSE_ROWS.map((row) => [row.fieldPath, row]));

const createTable3Skeleton = () => ({
  naturalPerson: {
    newReceived: 0,
    carriedOver: 0,
    results: {
      granted: 0,
      partialGrant: 0,
      denied: {
        stateSecret: 0,
        lawForbidden: 0,
        safetyStability: 0,
        thirdPartyRights: 0,
        internalAffairs: 0,
        processInfo: 0,
        enforcementCase: 0,
        adminQuery: 0,
      },
      unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
      notProcessed: {
        complaint: 0,
        repeat: 0,
        publication: 0,
        massiveRequests: 0,
        confirmInfo: 0,
      },
      other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
      totalProcessed: 0,
      carriedForward: 0,
    },
  },
  legalPerson: {
    commercial: {
      newReceived: 0,
      carriedOver: 0,
      results: {
        granted: 0,
        partialGrant: 0,
        denied: {
          stateSecret: 0,
          lawForbidden: 0,
          safetyStability: 0,
          thirdPartyRights: 0,
          internalAffairs: 0,
          processInfo: 0,
          enforcementCase: 0,
          adminQuery: 0,
        },
        unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
        notProcessed: {
          complaint: 0,
          repeat: 0,
          publication: 0,
          massiveRequests: 0,
          confirmInfo: 0,
        },
        other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
        totalProcessed: 0,
        carriedForward: 0,
      },
    },
    research: {
      newReceived: 0,
      carriedOver: 0,
      results: {
        granted: 0,
        partialGrant: 0,
        denied: {
          stateSecret: 0,
          lawForbidden: 0,
          safetyStability: 0,
          thirdPartyRights: 0,
          internalAffairs: 0,
          processInfo: 0,
          enforcementCase: 0,
          adminQuery: 0,
        },
        unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
        notProcessed: {
          complaint: 0,
          repeat: 0,
          publication: 0,
          massiveRequests: 0,
          confirmInfo: 0,
        },
        other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
        totalProcessed: 0,
        carriedForward: 0,
      },
    },
    social: {
      newReceived: 0,
      carriedOver: 0,
      results: {
        granted: 0,
        partialGrant: 0,
        denied: {
          stateSecret: 0,
          lawForbidden: 0,
          safetyStability: 0,
          thirdPartyRights: 0,
          internalAffairs: 0,
          processInfo: 0,
          enforcementCase: 0,
          adminQuery: 0,
        },
        unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
        notProcessed: {
          complaint: 0,
          repeat: 0,
          publication: 0,
          massiveRequests: 0,
          confirmInfo: 0,
        },
        other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
        totalProcessed: 0,
        carriedForward: 0,
      },
    },
    legal: {
      newReceived: 0,
      carriedOver: 0,
      results: {
        granted: 0,
        partialGrant: 0,
        denied: {
          stateSecret: 0,
          lawForbidden: 0,
          safetyStability: 0,
          thirdPartyRights: 0,
          internalAffairs: 0,
          processInfo: 0,
          enforcementCase: 0,
          adminQuery: 0,
        },
        unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
        notProcessed: {
          complaint: 0,
          repeat: 0,
          publication: 0,
          massiveRequests: 0,
          confirmInfo: 0,
        },
        other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
        totalProcessed: 0,
        carriedForward: 0,
      },
    },
    other: {
      newReceived: 0,
      carriedOver: 0,
      results: {
        granted: 0,
        partialGrant: 0,
        denied: {
          stateSecret: 0,
          lawForbidden: 0,
          safetyStability: 0,
          thirdPartyRights: 0,
          internalAffairs: 0,
          processInfo: 0,
          enforcementCase: 0,
          adminQuery: 0,
        },
        unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
        notProcessed: {
          complaint: 0,
          repeat: 0,
          publication: 0,
          massiveRequests: 0,
          confirmInfo: 0,
        },
        other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
        totalProcessed: 0,
        carriedForward: 0,
      },
    },
  },
  total: {
    newReceived: 0,
    carriedOver: 0,
    results: {
      granted: 0,
      partialGrant: 0,
      denied: {
        stateSecret: 0,
        lawForbidden: 0,
        safetyStability: 0,
        thirdPartyRights: 0,
        internalAffairs: 0,
        processInfo: 0,
        enforcementCase: 0,
        adminQuery: 0,
      },
      unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
      notProcessed: {
        complaint: 0,
        repeat: 0,
        publication: 0,
        massiveRequests: 0,
        confirmInfo: 0,
      },
      other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
      totalProcessed: 0,
      carriedForward: 0,
    },
  },
});

const getNested = (source, path) =>
  path.reduce((current, key) => (current && current[key] !== undefined ? current[key] : undefined), source);

const setNested = (target, path = [], value) => {
  if (!target || path.length === 0) return;
  let current = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  current[path[path.length - 1]] = value ?? 0;
};

const normalizeComparable = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return String(value);
};

const sumNumericValues = (values = []) =>
  values.reduce((sum, value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? sum + numeric : sum;
  }, 0);

const formatSourceExcerpt = (sourceText, anchorIndex, radius = 180) => {
  if (!sourceText) return '';
  const start = Math.max(0, anchorIndex - radius);
  const end = Math.min(sourceText.length, anchorIndex + radius);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < sourceText.length ? '...' : '';
  return `${prefix}${sourceText.slice(start, end)}${suffix}`;
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const pickCandidateCellLabel = (path) => {
  const matchedColumn = APPLICANT_COLUMNS.find((column) =>
    String(path || '').startsWith(`tableData.${column.fullPath}.`)
  );
  return matchedColumn?.label || String(path || '');
};

const pickTable3Data = (payload) => {
  if (!payload || typeof payload !== 'object') return null;

  const section = Array.isArray(payload.sections)
    ? payload.sections.find((item) => item?.type === 'table_3' && item?.tableData)
    : null;
  if (section?.tableData) return section.tableData;
  if (payload.tableData && typeof payload.tableData === 'object') return payload.tableData;
  if (payload.table_3 && typeof payload.table_3 === 'object') return payload.table_3;
  return null;
};

const buildTable3FromFacts = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const applicantPathMap = {
    natural_person: ['naturalPerson'],
    legal_person_commercial: ['legalPerson', 'commercial'],
    legal_person_research: ['legalPerson', 'research'],
    legal_person_social: ['legalPerson', 'social'],
    legal_person_legal: ['legalPerson', 'legal'],
    legal_person_other: ['legalPerson', 'other'],
    total: ['total'],
  };

  const responsePathMap = {
    new_received: ['newReceived'],
    carried_over: ['carriedOver'],
    granted: ['results', 'granted'],
    partial_grant: ['results', 'partialGrant'],
    denied_state_secret: ['results', 'denied', 'stateSecret'],
    denied_law_forbidden: ['results', 'denied', 'lawForbidden'],
    denied_safety_stability: ['results', 'denied', 'safetyStability'],
    denied_third_party_rights: ['results', 'denied', 'thirdPartyRights'],
    denied_internal_affairs: ['results', 'denied', 'internalAffairs'],
    denied_process_info: ['results', 'denied', 'processInfo'],
    denied_enforcement_case: ['results', 'denied', 'enforcementCase'],
    denied_admin_query: ['results', 'denied', 'adminQuery'],
    unable_no_info: ['results', 'unableToProvide', 'noInfo'],
    unable_need_creation: ['results', 'unableToProvide', 'needCreation'],
    unable_unclear: ['results', 'unableToProvide', 'unclear'],
    not_processed_complaint: ['results', 'notProcessed', 'complaint'],
    not_processed_repeat: ['results', 'notProcessed', 'repeat'],
    not_processed_publication: ['results', 'notProcessed', 'publication'],
    not_processed_massive_requests: ['results', 'notProcessed', 'massiveRequests'],
    not_processed_confirm_info: ['results', 'notProcessed', 'confirmInfo'],
    other_overdue_correction: ['results', 'other', 'overdueCorrection'],
    other_overdue_fee: ['results', 'other', 'overdueFee'],
    other_other_reasons: ['results', 'other', 'otherReasons'],
    total_processed: ['results', 'totalProcessed'],
    carried_forward: ['results', 'carriedForward'],
  };

  const tableData = createTable3Skeleton();

  rows.forEach((row) => {
    const applicantPath = applicantPathMap[row?.applicant_type];
    const responsePath = responsePathMap[row?.response_type];
    if (!applicantPath || !responsePath) return;
    setNested(tableData, [...applicantPath, ...responsePath], row?.count ?? 0);
  });

  return tableData;
};

const buildSnapshot = (tableData, fieldPath) => {
  if (!tableData || !fieldPath) return null;
  const pathKeys = fieldPath.split('.');
  const items = APPLICANT_COLUMNS.map((column) => ({
    key: column.key,
    label: column.label,
    factKey: column.factKey,
    value: getNested(tableData, [...column.dataPath, ...pathKeys]),
  }));
  const subtotal = sumNumericValues(items.filter((item) => item.key !== 'total').map((item) => item.value));
  const total = items.find((item) => item.key === 'total')?.value ?? null;
  return { items, subtotal, total };
};

const snapshotsEqual = (left, right) => {
  if (!left || !right) return false;
  return APPLICANT_COLUMNS.every((column) => {
    const leftValue = left.items.find((item) => item.key === column.key)?.value;
    const rightValue = right.items.find((item) => item.key === column.key)?.value;
    return normalizeComparable(leftValue) === normalizeComparable(rightValue);
  });
};

const cellsMatchSnapshot = (cells, snapshot) => {
  if (!Array.isArray(cells) || cells.length === 0 || !snapshot) return false;
  return APPLICANT_COLUMNS.every((column) => {
    const cell = cells.find((item) => item.col_key === column.factKey);
    const snapshotValue = snapshot.items.find((item) => item.key === column.key)?.value;
    const comparableCellValue =
      cell?.normalized_value ?? cell?.value_raw ?? cell?.value_num ?? cell?.value_semantic ?? null;
    return normalizeComparable(comparableCellValue) === normalizeComparable(snapshotValue);
  });
};

const buildSourceExcerpt = (sourceText, rowDef) => {
  if (!sourceText) return '';
  const terms = [
    ...(rowDef?.searchTerms || []),
    rowDef?.label || '',
    '收到和处理政府信息公开申请情况',
    '政府信息公开申请情况',
  ].filter(Boolean);

  for (const term of terms) {
    const index = sourceText.indexOf(term);
    if (index !== -1) {
      return formatSourceExcerpt(sourceText, index);
    }
  }

  return formatSourceExcerpt(sourceText, 0, 240);
};

const detectSourceSplit = (sourceExcerpt, candidates = []) => {
  if (!sourceExcerpt) return false;
  return candidates.some((candidate) => {
    const left = escapeRegExp(candidate.leftValue);
    const right = escapeRegExp(candidate.rightValue);
    const patterns = [
      new RegExp(`\\|\\s*${left}\\s*\\|\\s*${right}\\s*\\|`),
      new RegExp(`│\\s*${left}\\s*│\\s*${right}\\s*│`),
      new RegExp(`${left}\\s*[|│]\\s*${right}`),
    ];
    return patterns.some((pattern) => pattern.test(sourceExcerpt));
  });
};

const buildAssessment = ({
  parsedSnapshot,
  factsSnapshot,
  displaySnapshot,
  rowCells,
  sourceExcerpt,
  candidates,
  usingFactsSource,
}) => {
  const displayMatchesFacts = factsSnapshot ? snapshotsEqual(displaySnapshot, factsSnapshot) : false;
  const factsMatchParsed = parsedSnapshot && factsSnapshot ? snapshotsEqual(parsedSnapshot, factsSnapshot) : false;
  const cellsMatchFacts = factsSnapshot ? cellsMatchSnapshot(rowCells, factsSnapshot) : false;
  const sourceShowsSplit = detectSourceSplit(sourceExcerpt, candidates);

  const signals = [
    {
      tone: 'info',
      text: usingFactsSource ? '前台当前表格来自 facts.application' : '前台当前表格来自 parsed_json',
    },
  ];

  if (factsSnapshot) {
    signals.push({
      tone: displayMatchesFacts ? 'ok' : 'warn',
      text: displayMatchesFacts
        ? '前台展示与 facts.application 一致'
        : '前台展示与 facts.application 不一致，疑似前台映射或展示层问题',
    });
  } else {
    signals.push({ tone: 'muted', text: '当前版本尚未取到 facts.application 行数据' });
  }

  if (factsSnapshot && parsedSnapshot) {
    signals.push({
      tone: factsMatchParsed ? 'ok' : 'warn',
      text: factsMatchParsed
        ? 'parsed_json 与 facts.application 一致'
        : 'parsed_json 与 facts.application 不一致，疑似 materialize 链路发生变化',
    });
  } else {
    signals.push({ tone: 'muted', text: '当前版本暂无法完成 parsed_json 与 facts 的行级对照' });
  }

  if (rowCells.length > 0 && factsSnapshot) {
    signals.push({
      tone: cellsMatchFacts ? 'ok' : 'warn',
      text: cellsMatchFacts
        ? 'cells 与 facts.application 一致'
        : 'cells 与 facts.application 不一致，疑似 cells/materialize 层问题',
    });
  } else {
    signals.push({ tone: 'muted', text: '当前行未找到 cells 证据' });
  }

  if (sourceExcerpt) {
    signals.push({
      tone: sourceShowsSplit ? 'warn' : 'muted',
      text: sourceShowsSplit
        ? 'source_text 片段已出现相邻数字拆格痕迹'
        : 'source_text 片段未直接呈现拆格，仍不能排除 PDF 抽取问题',
    });
  } else {
    signals.push({ tone: 'muted', text: 'source_text 片段未命中，暂无法判断问题起点' });
  }

  let conclusion = '当前证据还不足以直接证明原始 PDF 视觉版是否本来就错，建议结合原件复核。';

  if (sourceShowsSplit && factsMatchParsed && (displayMatchesFacts || !factsSnapshot)) {
    conclusion = '更像是 source_text 或更早的抽取链路已经出现拆格，前台只是沿用结果展示。';
  } else if (factsSnapshot && parsedSnapshot && !factsMatchParsed) {
    conclusion = '更像是在 parsed_json 到 facts/cells 的物化链路中发生了变化。';
  } else if (factsSnapshot && !displayMatchesFacts) {
    conclusion = '更像是前台展示层或前台映射层造成了错位。';
  } else if (!sourceShowsSplit && factsMatchParsed && (displayMatchesFacts || !factsSnapshot)) {
    conclusion = 'parsed_json、facts、cells 基本一致，但当前仍无法直接证明 PDF 视觉原件是否本来就错。';
  }

  return {
    conclusion,
    signals,
  };
};

export function buildTable3TraceModel({
  sourceText,
  parsedPayload,
  factsRows,
  cellRows,
  displayPayload,
  usingFactsSource,
}) {
  const parsedTable = pickTable3Data(parsedPayload);
  const factsTable = buildTable3FromFacts(factsRows);
  const displayTable = pickTable3Data(displayPayload) || factsTable || parsedTable;
  const diagnostics = analyzeTable3Diagnostics(displayTable);

  const suspiciousRows = diagnostics.suspiciousRows.map((diagnosticRow) => {
    const rowDef = RESPONSE_ROW_MAP.get(diagnosticRow.key) || {
      factKey: diagnosticRow.key,
      fieldPath: diagnosticRow.key,
      label: diagnosticRow.key,
      searchTerms: [],
    };

    const candidates = (diagnosticRow.candidates || []).map((candidate) => ({
      leftLabel: pickCandidateCellLabel(candidate.leftPath),
      rightLabel: pickCandidateCellLabel(candidate.rightPath),
      leftValue: candidate.leftValue,
      rightValue: candidate.rightValue,
      mergedValue: candidate.mergedValue,
    }));

    const displaySnapshot = buildSnapshot(displayTable, rowDef.fieldPath);
    const parsedSnapshot = buildSnapshot(parsedTable, rowDef.fieldPath);
    const factsSnapshot = buildSnapshot(factsTable, rowDef.fieldPath);
    const rowCells = Array.isArray(cellRows)
      ? cellRows
          .filter((cell) => cell?.table_id === 'application' && cell?.row_key === rowDef.factKey)
          .sort(
            (left, right) =>
              (APPLICANT_INDEX.get(left?.col_key) ?? 999) - (APPLICANT_INDEX.get(right?.col_key) ?? 999)
          )
      : [];
    const sourceExcerpt = buildSourceExcerpt(sourceText, rowDef);
    const assessment = buildAssessment({
      parsedSnapshot,
      factsSnapshot,
      displaySnapshot,
      rowCells,
      sourceExcerpt,
      candidates,
      usingFactsSource,
    });

    return {
      fieldPath: rowDef.fieldPath,
      responseType: rowDef.factKey,
      rowLabel: rowDef.label,
      total: diagnosticRow.total,
      sum: diagnosticRow.sum,
      delta: diagnosticRow.delta,
      summary: `分项合计 ${diagnosticRow.sum}，总计 ${diagnosticRow.total}，存在 ${candidates.length} 组疑似拆格候选。`,
      candidates,
      displaySnapshot,
      parsedSnapshot,
      factsSnapshot,
      rowCells,
      sourceExcerpt,
      assessment,
    };
  });

  return {
    hasTable3: Boolean(displayTable || parsedTable || factsTable),
    displaySourceLabel: usingFactsSource ? 'facts.application' : 'parsed_json',
    suspiciousRows,
    caveat:
      '当前 cells 虽然保留了表格行列和值，但还没有稳定沉淀 PDF 页码和 bbox 原文定位证据，所以还不能 100% 判断 PDF 视觉原件是否本身就错表。',
  };
}
