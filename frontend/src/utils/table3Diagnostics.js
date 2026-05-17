const ENTITY_DEFINITIONS = [
  { key: 'naturalPerson', label: '自然人', dataPath: ['naturalPerson'], fullPath: 'naturalPerson' },
  {
    key: 'commercial',
    label: '商业企业',
    dataPath: ['legalPerson', 'commercial'],
    fullPath: 'legalPerson.commercial',
  },
  {
    key: 'research',
    label: '科研机构',
    dataPath: ['legalPerson', 'research'],
    fullPath: 'legalPerson.research',
  },
  { key: 'social', label: '社会公益组织', dataPath: ['legalPerson', 'social'], fullPath: 'legalPerson.social' },
  { key: 'legal', label: '法律服务机构', dataPath: ['legalPerson', 'legal'], fullPath: 'legalPerson.legal' },
  { key: 'other', label: '其他组织', dataPath: ['legalPerson', 'other'], fullPath: 'legalPerson.other' },
  { key: 'total', label: '总计', dataPath: ['total'], fullPath: 'total' },
];

const ROW_DEFINITIONS = [
  { fieldPath: 'newReceived', label: '本年新收申请数量' },
  { fieldPath: 'carriedOver', label: '上年结转申请数量' },
  { fieldPath: 'results.granted', label: '予以公开' },
  { fieldPath: 'results.partialGrant', label: '部分公开' },
  { fieldPath: 'results.denied.stateSecret', label: '不予公开：国家秘密' },
  { fieldPath: 'results.denied.lawForbidden', label: '不予公开：法律法规禁止公开' },
  { fieldPath: 'results.denied.safetyStability', label: '不予公开：三安全一稳定' },
  { fieldPath: 'results.denied.thirdPartyRights', label: '不予公开：第三方合法权益' },
  { fieldPath: 'results.denied.internalAffairs', label: '不予公开：内部事务信息' },
  { fieldPath: 'results.denied.processInfo', label: '不予公开：过程性信息' },
  { fieldPath: 'results.denied.enforcementCase', label: '不予公开：行政执法案卷' },
  { fieldPath: 'results.denied.adminQuery', label: '不予公开：行政查询事项' },
  { fieldPath: 'results.unableToProvide.noInfo', label: '无法提供：不掌握相关信息' },
  { fieldPath: 'results.unableToProvide.needCreation', label: '无法提供：需另行制作' },
  { fieldPath: 'results.unableToProvide.unclear', label: '无法提供：补正后仍不明确' },
  { fieldPath: 'results.notProcessed.complaint', label: '不予处理：信访举报投诉' },
  { fieldPath: 'results.notProcessed.repeat', label: '不予处理：重复申请' },
  { fieldPath: 'results.notProcessed.publication', label: '不予处理：公开出版物' },
  { fieldPath: 'results.notProcessed.massiveRequests', label: '不予处理：大量反复申请' },
  { fieldPath: 'results.notProcessed.confirmInfo', label: '不予处理：要求确认或重新出具' },
  { fieldPath: 'results.other.overdueCorrection', label: '其他处理：逾期不补正' },
  { fieldPath: 'results.other.overdueFee', label: '其他处理：逾期不缴费' },
  { fieldPath: 'results.other.otherReasons', label: '其他处理：其他' },
  { fieldPath: 'results.totalProcessed', label: '办理结果总计' },
  { fieldPath: 'results.carriedForward', label: '结转下年度继续办理' },
];

const NON_TOTAL_ENTITIES = ENTITY_DEFINITIONS.filter((entity) => entity.key !== 'total');
const RESULT_BREAKDOWN_ROWS = ROW_DEFINITIONS.filter(
  (row) => row.fieldPath.startsWith('results.') && !['results.totalProcessed', 'results.carriedForward'].includes(row.fieldPath)
);

const readPath = (source, path) =>
  path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), source);

const toNumberValue = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const isSingleDigitInteger = (value) => Number.isInteger(value) && value >= 0 && value <= 9;

const buildMergedValue = (leftValue, rightValue) => Number(`${leftValue}${rightValue}`);

const formatResultBreakdown = (data, entity) => {
  const items = RESULT_BREAKDOWN_ROWS.map((rowDef) => ({
    label: rowDef.label,
    value: toNumberValue(readPath(data, [...entity.dataPath, ...rowDef.fieldPath.split('.')])),
  })).filter((item) => item.value !== 0);

  if (items.length === 0) {
    return '办理结果明细均为 0';
  }

  return items.map((item) => `${item.label}${item.value}`).join('，');
};

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
        `${candidate.left.label} ${candidate.left.value} 与 ${candidate.right.label} ${candidate.right.value}，合并后为 ${candidate.mergedValue}`
    );
    const message = `${rowDef.label}：分项合计 ${sum}，总计 ${total}，存在疑似拆格。请对照原表复核相邻单数字是否应合并。`;
    const title = `${message} 疑似位置：${candidateLabels.join('；')}`;

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
          marker: '拆格',
          type: 'split',
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

    const rowLabel = `${entity.label}列`;
    const delta = outgoing - incoming;
    const direction = delta > 0 ? `三+四比一+二多 ${delta}` : `三+四比一+二少 ${Math.abs(delta)}`;
    const breakdown = formatResultBreakdown(data, entity);
    const message =
      `${rowLabel}纵向流转不一致（不是横向总计问题）：` +
      `一(${newReceived})+二(${carriedOver})=${incoming}，` +
      `三（办理结果总计 ${totalProcessed}）+四（结转 ${carriedForward}）=${outgoing}，` +
      `${direction}；本列非零办理明细：${breakdown}。`;
    const title =
      `${message} 横向合计只说明同一行各类别加总等于最右侧总计；` +
      `该校验检查同一列内部是否满足“一+二=三+四”。`;
    const affectedPaths = [
      `${basePath}.newReceived`,
      `${basePath}.carriedOver`,
      `${basePath}.results.totalProcessed`,
      `${basePath}.results.carriedForward`,
    ];

    const identityItem = {
      key: `${entity.fullPath}_identity`,
      entityFullPath: entity.fullPath,
      rowLabel,
      incoming,
      outgoing,
      delta: incoming - outgoing,
      direction,
      breakdown,
      formulaText: `一+二=${incoming}，三+四=${outgoing}`,
      message,
      title,
      paths: affectedPaths,
      newReceived,
      carriedOver,
      totalProcessed,
      carriedForward,
    };

    identityRows.push(identityItem);

    affectedPaths.forEach((path, index) => {
      // 0:newReceived=primary, 1:carriedOver=related, 2:totalProcessed=primary, 3:carriedForward=related
      const role = index % 2 === 0 ? 'primary' : 'related';
      suspiciousByPath.set(path, {
        rowLabel,
        title,
        marker: '勾稽',
        type: 'mismatch',
        role,
        formulaText: identityItem.formulaText,
        direction,
        identityKey: identityItem.key,
        paths: affectedPaths,
      });
    });
  });

  return { suspiciousRows, identityRows, suspiciousByPath };
}

export function getTable3SuspiciousCell(diagnostics, fullPath) {
  if (!diagnostics || !fullPath) return null;
  return diagnostics.suspiciousByPath.get(fullPath) || null;
}
