function coerceNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function buildTable3Skeleton(): any {
  const results = {
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
    unableToProvide: {
      noInfo: 0,
      needCreation: 0,
      unclear: 0,
    },
    notProcessed: {
      complaint: 0,
      repeat: 0,
      publication: 0,
      massiveRequests: 0,
      confirmInfo: 0,
    },
    other: {
      overdueCorrection: 0,
      overdueFee: 0,
      otherReasons: 0,
    },
    totalProcessed: 0,
    carriedForward: 0,
  };

  const entity = () => ({ newReceived: 0, carriedOver: 0, results: JSON.parse(JSON.stringify(results)) });

  return {
    naturalPerson: entity(),
    legalPerson: {
      commercial: entity(),
      research: entity(),
      social: entity(),
      legal: entity(),
      other: entity(),
    },
    total: entity(),
  };
}

function buildActiveDisclosureSkeleton(): any {
  return {
    regulations: { made: 0, repealed: 0, valid: 0 },
    normativeDocuments: { made: 0, repealed: 0, valid: 0 },
    licensing: { processed: 0 },
    punishment: { processed: 0 },
    coercion: { processed: 0 },
    fees: { amount: 0 },
  };
}

function buildReviewLitigationSkeleton(): any {
  return {
    review: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
    litigationDirect: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
    litigationPostReview: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
  };
}

function buildSectionsSkeleton(): any[] {
  return [
    { title: '一、总体情况', type: 'text', content: '' },
    { title: '二、主动公开政府信息情况', type: 'table_2', activeDisclosureData: buildActiveDisclosureSkeleton() },
    { title: '三、收到和处理政府信息公开申请情况', type: 'table_3', tableData: buildTable3Skeleton() },
    { title: '四、政府信息公开行政复议、行政诉讼情况', type: 'table_4', reviewLitigationData: buildReviewLitigationSkeleton() },
    { title: '五、存在的主要问题及改进情况', type: 'text', content: '' },
    { title: '六、其他需要报告的事项', type: 'text', content: '' },
    { title: '七、表6', type: 'table_6', content: [] },
    { title: '八、表7', type: 'table_7', content: [] },
    { title: '九、表8', type: 'table_8', content: [] },
  ];
}

const defaultReport = {
  sections: buildSectionsSkeleton(),
  activeDisclosureData: buildActiveDisclosureSkeleton(),
  tableData: buildTable3Skeleton(),
  reviewLitigationData: buildReviewLitigationSkeleton(),
};

function mergeWithTemplate(template: any, value: any): any {
  if (typeof template === 'number') {
    return coerceNumber(value);
  }

  if (Array.isArray(template)) {
    if (Array.isArray(value) && value.length) {
      const itemTemplate = template.length ? template[0] : undefined;
      if (itemTemplate === undefined) return value;
      return value.map((item) => mergeWithTemplate(itemTemplate, item));
    }
    return template;
  }

  if (template && typeof template === 'object') {
    const result: any = Array.isArray(template) ? [] : {};
    const valueObj = value && typeof value === 'object' ? value : {};

    for (const key of Object.keys(template)) {
      result[key] = mergeWithTemplate(template[key], (valueObj as any)[key]);
    }

    for (const key of Object.keys(valueObj)) {
      if (!(key in template)) {
        result[key] = valueObj[key];
      }
    }

    return result;
  }

  return value !== undefined ? value : template;
}

function normalizeSections(sections: any[]): any[] {
  const template = buildSectionsSkeleton();
  const incoming = Array.isArray(sections) ? sections : [];

  const matched = template.map((tpl) => {
    const found = incoming.find((s) => s?.type === tpl.type) || incoming.find((s) => s?.title === tpl.title);
    return mergeWithTemplate(tpl, found || {});
  });

  const extras = incoming.filter(
    (s) => s && !matched.find((m) => (m?.type && s?.type ? m.type === s.type : m?.title === s?.title))
  );

  return [...matched, ...extras];
}

export function normalizeParsedReport(parsed: any): any {
  const normalizedSections = normalizeSections(parsed?.sections);

  return {
    ...mergeWithTemplate(defaultReport, parsed || {}),
    sections: normalizedSections,
    activeDisclosureData: mergeWithTemplate(defaultReport.activeDisclosureData, parsed?.activeDisclosureData),
    tableData: mergeWithTemplate(defaultReport.tableData, parsed?.tableData),
    reviewLitigationData: mergeWithTemplate(defaultReport.reviewLitigationData, parsed?.reviewLitigationData),
  };
}

export { buildTable3Skeleton, buildActiveDisclosureSkeleton, buildReviewLitigationSkeleton, buildSectionsSkeleton };
