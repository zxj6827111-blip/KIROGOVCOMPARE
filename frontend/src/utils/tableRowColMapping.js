// 表格行列映射表
// 根据标准的政府信息公开年度报告格式

// 表三：政府信息公开申请情况
// 行定义: 1-表头, 2-自然人, 3-法人组织(商业企业), 4-科研机构, 5-社会公益组织, 6-法律服务机构, 7-其他组织, 8-总计
// 列定义: 1-申请人类别, 2-本年新收, 3-上年结转, 4-予以公开, 5-部分公开, 6-8项不予公开汇总, ...

export const TABLE3_ROW_COL_MAP = {
    // 自然人 (第2行)
    'tableData.naturalPerson.newReceived': { row: 2, col: 2, name: '本年新收' },
    'tableData.naturalPerson.previousYearCarryover': { row: 2, col: 3, name: '上年结转' },
    'tableData.naturalPerson.results.granted': { row: 2, col: 4, name: '予以公开' },
    'tableData.naturalPerson.results.partialGrant': { row: 2, col: 5, name: '部分公开' },
    'tableData.naturalPerson.results.denied.stateSecret': { row: 2, col: 6, name: '不予公开-国家秘密' },
    'tableData.naturalPerson.results.denied.lawForbidden': { row: 2, col: 7, name: '不予公开-法律禁止' },
    'tableData.naturalPerson.results.denied.safetyStability': { row: 2, col: 8, name: '不予公开-三安全一稳定' },
    'tableData.naturalPerson.results.denied.thirdPartyRights': { row: 2, col: 9, name: '不予公开-第三方权益' },
    'tableData.naturalPerson.results.denied.internalAffairs': { row: 2, col: 10, name: '不予公开-内部事务' },
    'tableData.naturalPerson.results.denied.processInfo': { row: 2, col: 11, name: '不予公开-过程性信息' },
    'tableData.naturalPerson.results.denied.enforcementCase': { row: 2, col: 12, name: '不予公开-执法案卷' },
    'tableData.naturalPerson.results.denied.adminQuery': { row: 2, col: 13, name: '不予公开-行政查询' },
    'tableData.naturalPerson.results.notDisclosed': { row: 2, col: 14, name: '不予公开汇总' },
    'tableData.naturalPerson.results.unableToProvide.noInfo': { row: 2, col: 15, name: '无法提供-不掌握' },
    'tableData.naturalPerson.results.unableToProvide.needCreation': { row: 2, col: 16, name: '无法提供-需制作' },
    'tableData.naturalPerson.results.unableToProvide.unclear': { row: 2, col: 17, name: '无法提供-不明确' },
    'tableData.naturalPerson.results.notAccepted.notOwnInfo': { row: 2, col: 18, name: '不予处理-非本机关' },
    'tableData.naturalPerson.results.notProcessed.complaint': { row: 2, col: 19, name: '不予处理-信访投诉' },
    'tableData.naturalPerson.results.notProcessed.repeat': { row: 2, col: 20, name: '不予处理-重复申请' },
    'tableData.naturalPerson.results.notProcessed.publication': { row: 2, col: 21, name: '不予处理-公开出版物' },
    'tableData.naturalPerson.results.notProcessed.massiveRequests': { row: 2, col: 22, name: '不予处理-大量反复' },
    'tableData.naturalPerson.results.notProcessed.confirmInfo': { row: 2, col: 23, name: '不予处理-要求确认' },
    'tableData.naturalPerson.results.other.overdueCorrection': { row: 2, col: 24, name: '其他-逾期不补正' },
    'tableData.naturalPerson.results.other.overdueFee': { row: 2, col: 25, name: '其他-逾期不缴费' },
    'tableData.naturalPerson.results.other.otherReasons': { row: 2, col: 26, name: '其他' },
    'tableData.naturalPerson.results.totalProcessed': { row: 2, col: 27, name: '办理结果总计' },
    'tableData.naturalPerson.results.carriedForward': { row: 2, col: 28, name: '结转下年度' },

    // 法人-商业企业 (第3行)
    'tableData.legalPerson.commercial.newReceived': { row: 3, col: 2, name: '本年新收' },
    'tableData.legalPerson.commercial.previousYearCarryover': { row: 3, col: 3, name: '上年结转' },
    'tableData.legalPerson.commercial.results.granted': { row: 3, col: 4, name: '予以公开' },
    'tableData.legalPerson.commercial.results.partialGrant': { row: 3, col: 5, name: '部分公开' },
    'tableData.legalPerson.commercial.results.totalProcessed': { row: 3, col: 27, name: '办理结果总计' },

    // 法人-科研机构 (第4行)
    'tableData.legalPerson.research.newReceived': { row: 4, col: 2, name: '本年新收' },
    'tableData.legalPerson.research.results.totalProcessed': { row: 4, col: 27, name: '办理结果总计' },

    // 法人-社会公益组织 (第5行)
    'tableData.legalPerson.social.newReceived': { row: 5, col: 2, name: '本年新收' },
    'tableData.legalPerson.social.results.totalProcessed': { row: 5, col: 27, name: '办理结果总计' },

    // 法人-法律服务机构 (第6行)
    'tableData.legalPerson.legal.newReceived': { row: 6, col: 2, name: '本年新收' },
    'tableData.legalPerson.legal.results.totalProcessed': { row: 6, col: 27, name: '办理结果总计' },

    // 法人-其他组织 (第7行)
    'tableData.legalPerson.other.newReceived': { row: 7, col: 2, name: '本年新收' },
    'tableData.legalPerson.other.results.totalProcessed': { row: 7, col: 27, name: '办理结果总计' },

    // 总计 (第8行)
    'tableData.total.newReceived': { row: 8, col: 2, name: '本年新收' },
    'tableData.total.previousYearCarryover': { row: 8, col: 3, name: '上年结转' },
    'tableData.total.results.granted': { row: 8, col: 4, name: '予以公开' },
    'tableData.total.results.partialGrant': { row: 8, col: 5, name: '部分公开' },
    'tableData.total.results.denied.stateSecret': { row: 8, col: 6, name: '不予公开-国家秘密' },
    'tableData.total.results.denied.lawForbidden': { row: 8, col: 7, name: '不予公开-法律禁止' },
    'tableData.total.results.denied.safetyStability': { row: 8, col: 8, name: '不予公开-三安全一稳定' },
    'tableData.total.results.denied.thirdPartyRights': { row: 8, col: 9, name: '不予公开-第三方权益' },
    'tableData.total.results.denied.internalAffairs': { row: 8, col: 10, name: '不予公开-内部事务' },
    'tableData.total.results.denied.processInfo': { row: 8, col: 11, name: '不予公开-过程性信息' },
    'tableData.total.results.denied.enforcementCase': { row: 8, col: 12, name: '不予公开-执法案卷' },
    'tableData.total.results.denied.adminQuery': { row: 8, col: 13, name: '不予公开-行政查询' },
    'tableData.total.results.notDisclosed': { row: 8, col: 14, name: '不予公开汇总' },
    'tableData.total.results.unableToProvide.noInfo': { row: 8, col: 15, name: '无法提供-不掌握' },
    'tableData.total.results.unableToProvide.needCreation': { row: 8, col: 16, name: '无法提供-需制作' },
    'tableData.total.results.unableToProvide.unclear': { row: 8, col: 17, name: '无法提供-不明确' },
    'tableData.total.results.notAccepted.notOwnInfo': { row: 8, col: 18, name: '不予处理-非本机关' },
    'tableData.total.results.notProcessed.complaint': { row: 8, col: 19, name: '不予处理-信访投诉' },
    'tableData.total.results.notProcessed.repeat': { row: 8, col: 20, name: '不予处理-重复申请' },
    'tableData.total.results.notProcessed.publication': { row: 8, col: 21, name: '不予处理-公开出版物' },
    'tableData.total.results.notProcessed.massiveRequests': { row: 8, col: 22, name: '不予处理-大量反复' },
    'tableData.total.results.notProcessed.confirmInfo': { row: 8, col: 23, name: '不予处理-要求确认' },
    'tableData.total.results.other.overdueCorrection': { row: 8, col: 24, name: '其他-逾期不补正' },
    'tableData.total.results.other.overdueFee': { row: 8, col: 25, name: '其他-逾期不缴费' },
    'tableData.total.results.other.otherReasons': { row: 8, col: 26, name: '其他' },
    'tableData.total.results.totalProcessed': { row: 8, col: 27, name: '办理结果总计' },
    'tableData.total.results.carriedForward': { row: 8, col: 28, name: '结转下年度' },
};

// 表四：行政复议、行政诉讼情况
export const TABLE4_ROW_COL_MAP = {
    // 行政复议 (第2行)
    'reviewLitigationData.review.maintain': { row: 2, col: 2, name: '维持' },
    'reviewLitigationData.review.correct': { row: 2, col: 3, name: '纠正' },
    'reviewLitigationData.review.other': { row: 2, col: 4, name: '其他' },
    'reviewLitigationData.review.unfinished': { row: 2, col: 5, name: '尚未审结' },
    'reviewLitigationData.review.total': { row: 2, col: 6, name: '总计' },

    // 未经复议直接起诉 (第3行)
    'reviewLitigationData.litigationDirect.maintain': { row: 3, col: 2, name: '维持' },
    'reviewLitigationData.litigationDirect.correct': { row: 3, col: 3, name: '纠正' },
    'reviewLitigationData.litigationDirect.other': { row: 3, col: 4, name: '其他' },
    'reviewLitigationData.litigationDirect.unfinished': { row: 3, col: 5, name: '尚未审结' },
    'reviewLitigationData.litigationDirect.total': { row: 3, col: 6, name: '总计' },

    // 复议后起诉 (第4行)
    'reviewLitigationData.litigationPostReview.maintain': { row: 4, col: 2, name: '维持' },
    'reviewLitigationData.litigationPostReview.correct': { row: 4, col: 3, name: '纠正' },
    'reviewLitigationData.litigationPostReview.other': { row: 4, col: 4, name: '其他' },
    'reviewLitigationData.litigationPostReview.unfinished': { row: 4, col: 5, name: '尚未审结' },
    'reviewLitigationData.litigationPostReview.total': { row: 4, col: 6, name: '总计' },
};

// 表二：主动公开政府信息情况
export const TABLE2_ROW_COL_MAP = {
    // 规章 (第2行)
    'activeDisclosureData.regulations.previousYear': { row: 2, col: 2, name: '上年有效' },
    'activeDisclosureData.regulations.currentYearMade': { row: 2, col: 3, name: '本年制定' },
    'activeDisclosureData.regulations.currentYearRepealed': { row: 2, col: 4, name: '本年废止' },
    'activeDisclosureData.regulations.currentYearValid': { row: 2, col: 5, name: '本年有效' },

    // 规范性文件 (第3行)
    'activeDisclosureData.normativeDocuments.previousYear': { row: 3, col: 2, name: '上年有效' },
    'activeDisclosureData.normativeDocuments.currentYearMade': { row: 3, col: 3, name: '本年制定' },
    'activeDisclosureData.normativeDocuments.currentYearRepealed': { row: 3, col: 4, name: '本年废止' },
    'activeDisclosureData.normativeDocuments.currentYearValid': { row: 3, col: 5, name: '本年有效' },
};

// 新版：统一解析三张表的位置（行/列）
const TABLE3_COLUMN_LABELS = {
    naturalPerson: '自然人',
    'legalPerson.commercial': '商业企业',
    'legalPerson.research': '科研机构',
    'legalPerson.social': '社会公益组织',
    'legalPerson.legal': '法律服务机构',
    'legalPerson.other': '其他',
    total: '总计',
};

const TABLE3_ROW_LABELS = {
    newReceived: '一、本年新收政府信息公开申请数量',
    carriedOver: '二、上年结转政府信息公开申请数量',
    'results.granted': '三、本年度办理结果 / （一）予以公开',
    'results.partialGrant': '三、本年度办理结果 / （二）部分公开',
    'results.denied.stateSecret': '三、本年度办理结果 / （三）不予公开 / 1.属于国家秘密',
    'results.denied.lawForbidden': '三、本年度办理结果 / （三）不予公开 / 2.其他法律行政法规禁止公开',
    'results.denied.safetyStability': '三、本年度办理结果 / （三）不予公开 / 3.危及“三安全一稳定”',
    'results.denied.thirdPartyRights': '三、本年度办理结果 / （三）不予公开 / 4.保护第三方合法权益',
    'results.denied.internalAffairs': '三、本年度办理结果 / （三）不予公开 / 5.属于三类内部事务信息',
    'results.denied.processInfo': '三、本年度办理结果 / （三）不予公开 / 6.属于四类过程性信息',
    'results.denied.enforcementCase': '三、本年度办理结果 / （三）不予公开 / 7.属于行政执法案卷',
    'results.denied.adminQuery': '三、本年度办理结果 / （三）不予公开 / 8.属于行政查询事项',
    'results.unableToProvide.noInfo': '三、本年度办理结果 / （四）无法提供 / 1.本机关不掌握相关政府信息',
    'results.unableToProvide.needCreation': '三、本年度办理结果 / （四）无法提供 / 2.没有现成信息需要另行制作',
    'results.unableToProvide.unclear': '三、本年度办理结果 / （四）无法提供 / 3.补正后申请内容仍不明确',
    'results.notProcessed.complaint': '三、本年度办理结果 / （五）不予处理 / 1.信访举报投诉类申请',
    'results.notProcessed.repeat': '三、本年度办理结果 / （五）不予处理 / 2.重复申请',
    'results.notProcessed.publication': '三、本年度办理结果 / （五）不予处理 / 3.要求提供公开出版物',
    'results.notProcessed.massiveRequests': '三、本年度办理结果 / （五）不予处理 / 4.无正当理由大量反复申请',
    'results.notProcessed.confirmInfo': '三、本年度办理结果 / （五）不予处理 / 5.要求行政机关确认或重新出具已获取信息',
    'results.other.overdueCorrection': '三、本年度办理结果 / （六）其他处理 / 1.申请人无正当理由逾期不补正',
    'results.other.overdueFee': '三、本年度办理结果 / （六）其他处理 / 2.申请人逾期未按收费通知要求缴纳费用',
    'results.other.otherReasons': '三、本年度办理结果 / （六）其他处理 / 3.其他',
    'results.totalProcessed': '三、本年度办理结果 / （七）总计',
    'results.carriedForward': '四、结转下年度继续办理',
};

const TABLE4_ROW_LABELS = {
    review: '行政复议',
    litigationDirect: '未经复议直接起诉',
    litigationPostReview: '复议后起诉',
};

const TABLE4_COL_LABELS = {
    maintain: '结果维持',
    correct: '结果纠正',
    other: '其他结果',
    unfinished: '尚未审结',
    total: '总计',
};

const TABLE2_ROW_LABELS = {
    regulations: '规章',
    normativeDocuments: '规范性文件',
    licensing: '行政许可',
    punishment: '行政处罚',
    coercion: '行政强制',
    fees: '行政事业性收费',
};

const TABLE2_COL_LABELS = {
    made: '本年制发件数',
    repealed: '本年废止件数',
    valid: '现行有效件数',
    processed: '本年处理决定数量',
    amount: '本年收费金额',
};

export const normalizeTablePath = (rawPath) => {
    if (!rawPath) return null;
    if (rawPath.startsWith('sections[table_2].')) {
        return `activeDisclosureData.${rawPath.replace('sections[table_2].', '')}`;
    }
    return rawPath;
};

const getTable3Location = (path) => {
    if (!path || !path.startsWith('tableData.')) return null;

    const raw = path.replace('tableData.', '');
    const parts = raw.split('.');
    if (parts.length < 2) return null;

    let entityKey = parts[0];
    let fieldPathParts = parts.slice(1);

    if (entityKey === 'legalPerson') {
        if (!parts[1]) return null;
        entityKey = `legalPerson.${parts[1]}`;
        fieldPathParts = parts.slice(2);
    }

    const fieldPath = fieldPathParts.join('.');
    const rowLabel = TABLE3_ROW_LABELS[fieldPath];
    const colLabel = TABLE3_COLUMN_LABELS[entityKey];

    if (!rowLabel && !colLabel) return null;

    return {
        table: '表三',
        rowLabel,
        colLabel,
    };
};

const getTable4Location = (path) => {
    if (!path || !path.startsWith('reviewLitigationData.')) return null;

    const raw = path.replace('reviewLitigationData.', '');
    const parts = raw.split('.');
    if (parts.length < 2) return null;

    const rowLabel = TABLE4_ROW_LABELS[parts[0]];
    const colLabel = TABLE4_COL_LABELS[parts[1]];

    if (!rowLabel && !colLabel) return null;

    return {
        table: '表四',
        rowLabel,
        colLabel,
    };
};

const getTable2Location = (path) => {
    if (!path || !path.startsWith('activeDisclosureData.')) return null;

    const raw = path.replace('activeDisclosureData.', '');
    const parts = raw.split('.');
    if (parts.length < 2) return null;

    const rowLabel = TABLE2_ROW_LABELS[parts[0]];
    const colLabel = TABLE2_COL_LABELS[parts[1]];

    if (!rowLabel && !colLabel) return null;

    return {
        table: '表二',
        rowLabel,
        colLabel,
    };
};

// 获取路径的行列信息
export const getRowColFromPath = (rawPath) => {
    if (!rawPath) return null;
    const path = normalizeTablePath(rawPath);

    const normalized = getTable3Location(path) || getTable4Location(path) || getTable2Location(path);
    if (normalized) return normalized;

    // 兼容旧字段映射
    if (TABLE3_ROW_COL_MAP[path]) {
        return { table: '表三', ...TABLE3_ROW_COL_MAP[path] };
    }

    if (TABLE4_ROW_COL_MAP[path]) {
        return { table: '表四', ...TABLE4_ROW_COL_MAP[path] };
    }

    if (TABLE2_ROW_COL_MAP[path]) {
        return { table: '表二', ...TABLE2_ROW_COL_MAP[path] };
    }

    return null;
};

// 获取多个路径的行列信息（用于求和项）
export const getRowColsFromPaths = (paths) => {
    if (!paths || paths.length === 0) return null;

    const results = paths
        .map(path => {
            const info = getRowColFromPath(path);
            return info ? { path, ...info } : null;
        })
        .filter(Boolean);

    if (results.length === 0) return null;

    // 按表分组
    const byTable = {};
    results.forEach(r => {
        if (!byTable[r.table]) byTable[r.table] = [];
        byTable[r.table].push(r);
    });

    return {
        all: results,
        byTable,
        mainTable: results[0].table,
    };
};
