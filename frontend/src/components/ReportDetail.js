import React, { useEffect, useState } from 'react';
import './ReportDetail.css';
import { apiClient } from '../apiClient';
import { Table2View, Table3View, Table4View } from './TableViews';
import { normalizeTablePath } from '../utils/tableRowColMapping';
import ParsedDataEditor from './ParsedDataEditor';
import ConsistencyCheckView from './ConsistencyCheckView';

const tryParseJsonText = (value) => {
  if (typeof value !== 'string') return { ok: false, value: null };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, value: null };
  const cleaned = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch {
    return { ok: false, value: null };
  }
};

const deepParseJson = (input, maxDepth = 3) => {
  let current = input;
  for (let i = 0; i < maxDepth; i += 1) {
    if (typeof current !== 'string') return current;
    const parsed = tryParseJsonText(current);
    if (!parsed.ok) return current;
    current = parsed.value;
  }
  return current;
};

const pick = (obj, keys = []) => {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key];
  }
  return undefined;
};

const hasMeaningfulObjectData = (obj) => {
  if (!obj || typeof obj !== 'object') return false;
  return Object.values(obj).some((value) => {
    if (value === null || value === undefined || value === '') return false;
    if (typeof value === 'object') return hasMeaningfulObjectData(value);
    return true;
  });
};

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
      notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
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
      notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
      other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
      totalProcessed: 0,
      carriedForward: 0,
    },
  },
});

const setNested = (obj, path = [], value) => {
  if (!obj || !Array.isArray(path) || path.length === 0) return;
  let target = obj;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (!target[key] || typeof target[key] !== 'object') {
      target[key] = {};
    }
    target = target[key];
  }
  target[path[path.length - 1]] = value ?? 0;
};

const extractApplicantCounts = (row) => {
  if (!row || typeof row !== 'object') return null;

  const legalOrgs =
    pick(row, ['legalPersonsOrOtherOrganizations', 'legalPerson', 'legalPersons']) || {};

  return {
    naturalPerson: pick(row, ['naturalPerson', 'naturalPersons']) ?? 0,
    commercial:
      pick(legalOrgs, ['commercial', 'commercialEnterprise', 'commercialEnterprises']) ?? 0,
    research: pick(legalOrgs, ['research', 'researchInstitution', 'researchInstitutions']) ?? 0,
    social:
      pick(legalOrgs, ['social', 'socialWelfareOrganization', 'socialWelfareOrganizations']) ?? 0,
    legal: pick(legalOrgs, ['legal', 'legalServiceOrganization', 'legalServiceOrganizations']) ?? 0,
    other: pick(legalOrgs, ['other', 'others']) ?? 0,
    total: pick(row, ['total']) ?? 0,
  };
};

const assignLegacyRow = (tableData, rowPath = [], rowData) => {
  const values = extractApplicantCounts(rowData);
  if (!values) return;
  const routes = [
    { key: 'naturalPerson', target: tableData.naturalPerson },
    { key: 'commercial', target: tableData.legalPerson.commercial },
    { key: 'research', target: tableData.legalPerson.research },
    { key: 'social', target: tableData.legalPerson.social },
    { key: 'legal', target: tableData.legalPerson.legal },
    { key: 'other', target: tableData.legalPerson.other },
    { key: 'total', target: tableData.total },
  ];
  routes.forEach(({ key, target }) => setNested(target, rowPath, values[key]));
};

const normalizeTable2Data = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const pickTable2 = (obj, aliases) => pick(obj, aliases);
  const mapEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    return {
      made: pickTable2(entry, ['made', 'currentYearMade', 'issuedThisYear']),
      repealed: pickTable2(entry, ['repealed', 'currentYearRepealed', 'abolishedThisYear']),
      valid: pickTable2(entry, ['valid', 'currentYearValid', 'currentlyEffective']),
    };
  };

  return {
    regulations: mapEntry(pickTable2(raw, ['regulations'])) || { made: 0, repealed: 0, valid: 0 },
    normativeDocuments: mapEntry(pickTable2(raw, ['normativeDocuments'])) || {
      made: 0,
      repealed: 0,
      valid: 0,
    },
    licensing: {
      processed:
        pickTable2(pickTable2(raw, ['licensing', 'administrativeLicensing']), [
          'processed',
          'decisionsThisYear',
        ]) ?? 0,
    },
    punishment: {
      processed:
        pickTable2(pickTable2(raw, ['punishment', 'administrativePenalty']), [
          'processed',
          'decisionsThisYear',
        ]) ?? 0,
    },
    coercion: {
      processed:
        pickTable2(pickTable2(raw, ['coercion', 'administrativeCoercion']), [
          'processed',
          'decisionsThisYear',
        ]) ?? 0,
    },
    fees: {
      amount:
        pickTable2(pickTable2(raw, ['fees', 'administrativeCharges']), [
          'amount',
          'amountThisYear',
        ]) ?? 0,
    },
  };
};

const normalizeTable3Data = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  // Already current structure
  if (raw.naturalPerson && raw.legalPerson && raw.total) {
    return raw;
  }

  const tableData = createTable3Skeleton();

  assignLegacyRow(
    tableData,
    ['newReceived'],
    pick(raw, ['newReceived', 'newlyReceived', 'receivedThisYear'])
  );
  assignLegacyRow(
    tableData,
    ['carriedOver'],
    pick(raw, ['carriedOver', 'carriedOverFromLastYear'])
  );
  assignLegacyRow(tableData, ['results', 'granted'], pick(raw, ['granted', 'disclosed']));
  assignLegacyRow(
    tableData,
    ['results', 'partialGrant'],
    pick(raw, ['partialGrant', 'partiallyDisclosed'])
  );
  assignLegacyRow(
    tableData,
    ['results', 'totalProcessed'],
    pick(raw, ['totalProcessed', 'resultsThisYear'])
  );
  assignLegacyRow(
    tableData,
    ['results', 'carriedForward'],
    pick(raw, ['carriedForward', 'carriedToNextYear'])
  );

  const denied = pick(raw, ['denied', 'notDisclosed']) || {};
  assignLegacyRow(tableData, ['results', 'denied', 'stateSecret'], pick(denied, ['stateSecret']));
  assignLegacyRow(
    tableData,
    ['results', 'denied', 'lawForbidden'],
    pick(denied, ['lawForbidden', 'otherLegalAdministrativeProvisionsForbidden'])
  );
  assignLegacyRow(
    tableData,
    ['results', 'denied', 'safetyStability'],
    pick(denied, ['safetyStability', 'endangeringSecurityStability'])
  );
  assignLegacyRow(
    tableData,
    ['results', 'denied', 'thirdPartyRights'],
    pick(denied, ['thirdPartyRights', 'harmThirdPartyInterests'])
  );
  assignLegacyRow(
    tableData,
    ['results', 'denied', 'internalAffairs'],
    pick(denied, ['internalAffairs', 'internalManagementInfo'])
  );
  assignLegacyRow(
    tableData,
    ['results', 'denied', 'processInfo'],
    pick(denied, ['processInfo', 'processInformation'])
  );
  assignLegacyRow(
    tableData,
    ['results', 'denied', 'enforcementCase'],
    pick(denied, ['enforcementCase', 'lawEnforcementCaseFiles'])
  );
  assignLegacyRow(
    tableData,
    ['results', 'denied', 'adminQuery'],
    pick(denied, ['adminQuery', 'administrativeInquiryItems'])
  );

  const unable = pick(raw, ['unableToProvide', 'unableToDisclose']) || {};
  assignLegacyRow(
    tableData,
    ['results', 'unableToProvide', 'noInfo'],
    pick(unable, ['noInfo', 'notHeld'])
  );
  assignLegacyRow(
    tableData,
    ['results', 'unableToProvide', 'needCreation'],
    pick(unable, ['needCreation', 'needToCreate'])
  );
  assignLegacyRow(
    tableData,
    ['results', 'unableToProvide', 'unclear'],
    pick(unable, ['unclear', 'uncertainRequestContent'])
  );

  const notProcessed = pick(raw, ['notProcessed']) || {};
  assignLegacyRow(
    tableData,
    ['results', 'notProcessed', 'complaint'],
    pick(notProcessed, ['complaint', 'petitionComplaint'])
  );
  assignLegacyRow(
    tableData,
    ['results', 'notProcessed', 'repeat'],
    pick(notProcessed, ['repeat', 'duplicateRequest'])
  );
  assignLegacyRow(
    tableData,
    ['results', 'notProcessed', 'publication'],
    pick(notProcessed, ['publication', 'publicationsRequest'])
  );
  assignLegacyRow(
    tableData,
    ['results', 'notProcessed', 'massiveRequests'],
    pick(notProcessed, ['massiveRequests', 'maliciousFrequentRequests'])
  );
  assignLegacyRow(
    tableData,
    ['results', 'notProcessed', 'confirmInfo'],
    pick(notProcessed, ['confirmInfo', 'confirmOrReissue'])
  );

  const other = pick(raw, ['other']) || {};
  assignLegacyRow(
    tableData,
    ['results', 'other', 'overdueCorrection'],
    pick(other, ['overdueCorrection'])
  );
  assignLegacyRow(tableData, ['results', 'other', 'overdueFee'], pick(other, ['overdueFee']));
  assignLegacyRow(
    tableData,
    ['results', 'other', 'otherReasons'],
    pick(other, ['otherReasons', 'other'])
  );

  return tableData;
};

const normalizeTable4Data = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const pickCase = (obj, aliases) => pick(obj, aliases) || {};
  const mapCase = (entry) => ({
    maintain: pick(entry, ['maintain', 'resultMaintain']) ?? 0,
    correct: pick(entry, ['correct', 'resultCorrect']) ?? 0,
    other: pick(entry, ['other', 'otherResult']) ?? 0,
    unfinished: pick(entry, ['unfinished', 'pending']) ?? 0,
    total: pick(entry, ['total']) ?? 0,
  });

  return {
    review: mapCase(
      pickCase(raw, ['review', 'administrativeReview', 'administrativeReconsideration'])
    ),
    litigationDirect: mapCase(
      pickCase(raw, [
        'litigationDirect',
        'administrativeLitigationDirect',
        'litigationWithoutReview',
      ])
    ),
    litigationPostReview: mapCase(
      pickCase(raw, [
        'litigationPostReview',
        'administrativeLitigationAfterReview',
        'litigationAfterReview',
      ])
    ),
  };
};

const normalizeParsedPayload = (parsed) => {
  const parsedValue = deepParseJson(parsed);

  if (!parsedValue || typeof parsedValue !== 'object') {
    return parsedValue;
  }

  // Some model outputs wrap real JSON in raw_text as escaped string
  const rawTextParsed = deepParseJson(parsedValue.raw_text);
  const candidate =
    rawTextParsed && typeof rawTextParsed === 'object'
      ? { ...parsedValue, ...rawTextParsed }
      : parsedValue;

  if (Array.isArray(candidate.sections) && candidate.sections.length > 0) {
    return candidate;
  }

  const table2Raw = pick(candidate, ['activeDisclosureData', 'table_2']);
  const table3Raw = pick(candidate, ['tableData', 'table_3']);
  const table4Raw = pick(candidate, ['reviewLitigationData', 'table_4']);

  const table2 = normalizeTable2Data(table2Raw);
  const table3 = normalizeTable3Data(table3Raw);
  const table4 = normalizeTable4Data(table4Raw);

  const sections = [];
  if (hasMeaningfulObjectData(table2)) {
    sections.push({
      title: '二、主动公开政府信息情况',
      type: 'table_2',
      activeDisclosureData: table2,
    });
  }
  if (hasMeaningfulObjectData(table3)) {
    sections.push({
      title: '三、收到和处理政府信息公开申请情况',
      type: 'table_3',
      tableData: table3,
    });
  }
  if (hasMeaningfulObjectData(table4)) {
    sections.push({
      title: '四、政府信息公开行政复议、行政诉讼情况',
      type: 'table_4',
      reviewLitigationData: table4,
    });
  }

  if (sections.length > 0) {
    return { ...candidate, sections };
  }

  return candidate;
};

function ReportDetail({ reportId: propReportId, onBack }) {
  const reportId = propReportId || window.location.pathname.split('/').pop();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showParsed, setShowParsed] = useState(true); // 默认展开
  const [showMetadata, setShowMetadata] = useState(false); // 元数据默认隐藏
  const [editingData, setEditingData] = useState(null); // 编辑模式
  const [activeTab, setActiveTab] = useState('content'); // 'content' | 'checks'
  const [highlightCells, setHighlightCells] = useState([]); // 勾稽问题单元格路径
  const [highlightTexts, setHighlightTexts] = useState([]); // 勾稽问题文本
  const [focusedCheck, setFocusedCheck] = useState(null); // 当前定位的勾稽问题
  const [focusedCells, setFocusedCells] = useState([]); // 定位模式下的单元格路径
  const [qualityIssues, setQualityIssues] = useState({}); // 质量审计问题 { sec5: [...], sec6: [...] }
  const [showVersionHistory, setShowVersionHistory] = useState(false); // 版本历史折叠
  const [versionHistory, setVersionHistory] = useState(null); // 历史版本列表数据
  const [versionsLoading, setVersionsLoading] = useState(false);
  const isTablePath = (p) =>
    p &&
    (p.includes('tableData') ||
      p.includes('reviewLitigationData') ||
      p.includes('activeDisclosureData'));

  const handleBack = () => {
    if (onBack) return onBack();
    window.history.back();
  };

  useEffect(() => {
    const fetchDetail = async () => {
      if (!reportId) return;
      setLoading(true);
      setError('');
      try {
        const response = await apiClient.get(`/reports/${reportId}`);
        const payload = response.data?.data ?? response.data?.report ?? response.data;
        setReport(payload || null);
      } catch (err) {
        const message = err.response?.data?.error || err.message || '请求失败';
        setError(`加载报告详情失败：${message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [reportId]);

  useEffect(() => {
    setFocusedCheck(null);
    setFocusedCells([]);
  }, [reportId]);

  // 获取勾稽校验问题数据用于高亮
  const fetchHighlights = async () => {
    if (!reportId) return;
    try {
      const response = await apiClient.get(`/reports/${reportId}/checks`);
      const data = response.data?.data || response.data;
      const groups = data?.groups || [];

      console.log('[DEBUG ReportDetail] Fetched checks data:', data);

      // 提取未确认的问题路径
      const cellPaths = [];
      const textInfos = [];
      const sec5Issues = [];
      const sec6Issues = [];

      groups.forEach((group) => {
        (group.items || []).forEach((item) => {
          // 只高亮未确认、未忽略的问题
          if (
            item.human_status !== 'confirmed' &&
            item.human_status !== 'dismissed' &&
            (item.auto_status === 'FAIL' || item.auto_status === 'UNCERTAIN')
          ) {
            // 提取质量审计问题（Section 5/6）
            const groupKey = group.groupKey || group.group_key;
            if (groupKey === 'quality') {
              if (item.check_key === 'narrative_sec5_gap') {
                sec5Issues.push({ title: item.title, status: item.auto_status });
              } else if (item.check_key === 'narrative_sec6_fee_conflict') {
                sec6Issues.push({ title: item.title, status: item.auto_status });
              }
            }

            // New logic: Check distinct left/right paths first
            const leftPaths = item.evidence?.leftPaths || [];
            const rightPaths = item.evidence?.rightPaths || [];
            const allPaths = item.evidence?.paths || [];

            if (leftPaths.length > 0 || rightPaths.length > 0) {
              leftPaths.forEach((p) => {
                const normalized = normalizeTablePath(p);
                if (isTablePath(normalized)) cellPaths.push({ path: normalized, type: 'left' });
              });
              rightPaths.forEach((p) => {
                const normalized = normalizeTablePath(p);
                if (isTablePath(normalized)) cellPaths.push({ path: normalized, type: 'right' });
              });
            } else {
              // Fallback for logic without split paths
              allPaths.forEach((p) => {
                const normalized = normalizeTablePath(p);
                if (isTablePath(normalized)) {
                  // Default to 'diff' or generic highlight if we don't know
                  cellPaths.push({ path: normalized, type: 'diff' });
                }
              });
            }

            // Text Info extraction
            allPaths.forEach((p) => {
              if (p.includes('text') || p.includes('content')) {
                // 提取文本问题信息
                const textValue = item.evidence?.values?.textValue;
                if (textValue) {
                  textInfos.push({ value: textValue, context: item.evidence?.values?.context });
                }
              }
            });
          }
        });
      });

      console.log('[DEBUG ReportDetail] Final cellPaths:', cellPaths);
      console.log('[DEBUG ReportDetail] Final textInfos:', textInfos);
      console.log('[DEBUG ReportDetail] Quality issues - Sec5:', sec5Issues, 'Sec6:', sec6Issues);
      setHighlightCells(cellPaths);
      setHighlightTexts(textInfos);
      setQualityIssues({ sec5: sec5Issues, sec6: sec6Issues });
    } catch (err) {
      console.error('Failed to fetch highlights:', err);
    }
  };

  const buildFocusCells = (leftPaths = [], rightPaths = []) => {
    const toCells = (paths, type) =>
      (paths || [])
        .map((p) => normalizeTablePath(p))
        .filter((p) => p && isTablePath(p))
        .map((path) => ({ path, type, scope: 'focus' }));

    return [...toCells(leftPaths, 'left'), ...toCells(rightPaths, 'right')];
  };

  const scrollToFirstCell = (paths = []) => {
    const targets = (paths || [])
      .map((p) => normalizeTablePath(p))
      .filter((p) => p && isTablePath(p));

    if (targets.length === 0) return;

    setTimeout(() => {
      for (const path of targets) {
        const cell = document.querySelector(`[data-cell-path="${path}"]`);
        if (cell) {
          cell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          break;
        }
      }
    }, 160);
  };

  const handleLocateIssue = ({ title, leftPaths = [], rightPaths = [] }) => {
    const focusCells = buildFocusCells(leftPaths, rightPaths);
    if (focusCells.length === 0) return;

    setFocusedCheck({ title: title || '勾稽关系定位' });
    setFocusedCells(focusCells);
    setActiveTab('content');
    setShowParsed(true);
    scrollToFirstCell(leftPaths.length > 0 ? leftPaths : rightPaths);
  };

  const clearFocus = () => {
    setFocusedCheck(null);
    setFocusedCells([]);
  };

  // 加载报告时同时获取高亮数据
  useEffect(() => {
    if (reportId) {
      fetchHighlights();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, activeTab]); // activeTab 变化时也刷新

  const refresh = async () => {
    if (!reportId) return;
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get(`/reports/${reportId}`);
      const payload = response.data?.data ?? response.data?.report ?? response.data;
      setReport(payload || null);
    } catch (err) {
      const message = err.response?.data?.error || err.message || '请求失败';
      setError(`刷新失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  const pollJob = async (jobId, { timeoutMs = 120000, intervalMs = 1500 } = {}) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const resp = await apiClient.get(`/jobs/task/${jobId}`);
      const status = (resp.data?.status || '').toLowerCase();
      if (status === 'succeeded' || status === 'failed') {
        return resp.data;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error('等待解析超时，请稍后再试');
  };

  const handleReparse = async () => {
    if (!reportId) return;
    if (!window.confirm('确认重新触发解析吗？将创建新的 parse job。')) return;
    setError('');
    setLoading(true);
    try {
      const resp = await apiClient.post(`/reports/${reportId}/parse`);
      const jobId = resp.data?.job_id || resp.data?.jobId;
      if (!jobId) throw new Error('未返回 job_id');

      const job = await pollJob(jobId);
      if ((job.status || '').toLowerCase() === 'failed') {
        throw new Error(job.error || 'parse_failed');
      }
      await refresh();
    } catch (err) {
      setError(err.message || '重新解析失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!reportId) return;
    if (!window.confirm(`确认删除报告 #${reportId} 吗？`)) return;
    setError('');
    setLoading(true);
    try {
      await apiClient.delete(`/reports/${reportId}`);
      handleBack();
    } catch (err) {
      const message = err.response?.data?.error || err.message || '请求失败';
      setError(`删除失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEdit = (saveData) => {
    // Support both old format (direct data) and new format (object with parsedJson/newVersionId)
    const parsedJson = saveData?.parsedJson ?? saveData;
    const newVersionId = saveData?.newVersionId;

    setReport({
      ...report,
      active_version: {
        ...report.active_version,
        parsed_json: parsedJson,
        version_id: newVersionId ?? report.active_version?.version_id,
      },
    });
    setEditingData(null);
    // No need to alert here - ParsedDataEditor already shows alert
  };

  const handleCancelEdit = () => {
    setEditingData(null);
  };

  // 对文本中的问题数字进行高亮 - SECURITY FIX: Use safe React elements instead of dangerouslySetInnerHTML
  const highlightTextIssues = (text, highlights) => {
    if (!highlights || highlights.length === 0 || !text) return text;

    // Collect all values to highlight
    const valuesToHighlight = highlights
      .map((h) => h.value)
      .filter((v) => v !== null && v !== undefined)
      .map((v) => String(v));

    if (valuesToHighlight.length === 0) return text;

    // Build result as React elements
    const elements = [];
    let remainingText = String(text);
    let keyIndex = 0;

    // For each value to highlight, split and reconstruct
    for (const numStr of valuesToHighlight) {
      const parts = remainingText.split(numStr);
      if (parts.length > 1) {
        const newParts = [];
        for (let idx = 0; idx < parts.length; idx += 1) {
          const part = parts[idx];
          if (part) newParts.push(part);
          if (idx < parts.length - 1) {
            newParts.push(
              <mark key={`hl-${keyIndex}`} className="text-warning">
                {numStr}
              </mark>
            );
            keyIndex += 1;
          }
        }
        // Convert back to components
        if (elements.length === 0) {
          elements.push(...newParts);
        }
        remainingText = parts.join(`{{HL${numStr}HL}}`);
      }
    }

    // If no highlights found, return original text
    if (elements.length === 0) return text;

    return <span>{elements}</span>;
  };

  const isFocusMode = focusedCells.length > 0 && focusedCheck;
  const activeHighlightCells = isFocusMode ? focusedCells : highlightCells;
  const normalizedParsedJson = normalizeParsedPayload(report?.active_version?.parsed_json);

  const renderParsedContent = (parsed) => {
    const normalized = normalizeParsedPayload(parsed);
    if (!normalized) return <p className="meta">暂无解析内容</p>;

    // 如果是对象且包含sections，则渲染结构化内容
    if (
      normalized &&
      typeof normalized === 'object' &&
      normalized.sections &&
      Array.isArray(normalized.sections)
    ) {
      return renderStructuredContent(normalized);
    }

    // 否则显示原始JSON
    const text = typeof normalized === 'string' ? normalized : JSON.stringify(normalized, null, 2);
    const preview = text.length > 600 ? `${text.slice(0, 600)}...` : text;

    return (
      <div className="parsed-section">
        <button className="secondary-btn" onClick={() => setShowParsed((prev) => !prev)}>
          {showParsed ? '折叠解析' : '展开解析'}
        </button>
        {showParsed && <pre className="parsed-json">{preview}</pre>}
      </div>
    );
  };

  const renderStructuredContent = (parsed) => {
    if (!parsed || !parsed.sections) return null;

    // 对sections进行排序，将标题放在最前面
    const sections = [...parsed.sections];
    sections.sort((a, b) => {
      const isATi = a.title === '标题' || a.title?.includes('年度报告');
      const isBTi = b.title === '标题' || b.title?.includes('年度报告');
      if (isATi && !isBTi) return -1;
      if (!isATi && isBTi) return 1;

      // 按照 一、二、三 等中文数字排序
      const numerals = ['一', '二', '三', '四', '五', '六', '七', '八'];
      const idxA = numerals.findIndex((n) => a.title?.includes(n));
      const idxB = numerals.findIndex((n) => b.title?.includes(n));
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });

    const handleEditClick = () => {
      setEditingData({ data: parsed, highlightPaths: [] });
    };

    return (
      <div className="structured-content">
        <div className="content-header">
          <h3>年报内容</h3>
          <div>
            <button className="btn-edit" onClick={handleEditClick} style={{ marginRight: '10px' }}>
              ✎ 编辑全部
            </button>
            <button className="secondary-btn" onClick={() => setShowParsed((prev) => !prev)}>
              {showParsed ? '折叠内容' : '展开内容'}
            </button>
          </div>
        </div>

        {isFocusMode && (
          <div className="focus-banner">
            <div className="focus-title">定位：{focusedCheck?.title}</div>
            <div className="focus-actions">
              <span className="focus-legend">蓝色=左值，橙色=右值，角标显示左/右</span>
              <button className="btn-clear-focus" onClick={clearFocus}>
                清除定位
              </button>
            </div>
          </div>
        )}

        {showParsed && (
          <div className="sections-container">
            {sections.map((section, idx) => (
              <div key={idx} className="section-item">
                <h4 className="section-title">
                  {section.title}
                  {/* 显示第五/六部分的质量问题标记 */}
                  {section.title?.includes('五') &&
                    qualityIssues.sec5 &&
                    qualityIssues.sec5.length > 0 && (
                      <span
                        className="quality-issue-badge"
                        title={qualityIssues.sec5.map((i) => i.title).join('\n')}
                      >
                        ⚠️ {qualityIssues.sec5.length}个问题
                      </span>
                    )}
                  {section.title?.includes('六') &&
                    qualityIssues.sec6 &&
                    qualityIssues.sec6.length > 0 && (
                      <span
                        className="quality-issue-badge"
                        title={qualityIssues.sec6.map((i) => i.title).join('\n')}
                      >
                        ⚠️ {qualityIssues.sec6.length}个问题
                      </span>
                    )}
                </h4>
                <div className="section-content">
                  {/* 显示质量问题详情 */}
                  {section.title?.includes('五') &&
                    qualityIssues.sec5 &&
                    qualityIssues.sec5.length > 0 && (
                      <div className="quality-issues-alert">
                        {qualityIssues.sec5.map((issue, i) => (
                          <div key={i} className="issue-item">
                            <span className="issue-icon">⚠️</span>
                            <span className="issue-text">{issue.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  {section.title?.includes('六') &&
                    qualityIssues.sec6 &&
                    qualityIssues.sec6.length > 0 && (
                      <div className="quality-issues-alert">
                        {qualityIssues.sec6.map((issue, i) => (
                          <div key={i} className="issue-item">
                            <span className="issue-icon">⚠️</span>
                            <span className="issue-text">{issue.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  {section.type === 'text' && (
                    <div className="text-content">
                      {highlightTextIssues(section.content, highlightTexts)}
                    </div>
                  )}
                  {section.type === 'table_2' && section.activeDisclosureData && (
                    <Table2View
                      data={section.activeDisclosureData}
                      highlightCells={activeHighlightCells}
                    />
                  )}
                  {section.type === 'table_3' && section.tableData && (
                    <Table3View
                      data={section.tableData}
                      compact={true}
                      highlightCells={activeHighlightCells}
                    />
                  )}
                  {section.type === 'table_4' && section.reviewLitigationData && (
                    <Table4View
                      data={section.reviewLitigationData}
                      highlightCells={activeHighlightCells}
                    />
                  )}
                  {!['text', 'table_2', 'table_3', 'table_4'].includes(section.type) && (
                    <div className="unknown-type">
                      <p className="meta">未知类型: {section.type}</p>
                      <pre>{JSON.stringify(section, null, 2)}</pre>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderJobDetail = (job) => {
    if (!job) return <p className="meta">暂无任务信息</p>;
    return (
      <div className="grid">
        <div>
          <p className="label">任务 ID</p>
          <p className="value">{job.job_id}</p>
        </div>
        <div>
          <p className="label">状态</p>
          <p className="value">{job.status}</p>
        </div>
        <div>
          <p className="label">进度</p>
          <p className="value">{job.progress ?? '—'}%</p>
        </div>
        {job.error_message && (
          <div className="full-row">
            <p className="label">错误信息</p>
            <p className="value error-text">{job.error_message}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="report-detail">
      <div className="card">
        <div className="detail-header">
          <div>
            <h2>报告详情</h2>
            <p className="subtitle">查看报告、最新任务与生效版本信息</p>
          </div>
          <div className="actions">
            <button className="action-btn" onClick={refresh} disabled={loading}>
              ↻ 刷新
            </button>
            <button className="action-btn" onClick={handleReparse} disabled={loading}>
              ⟳ 自动解析
            </button>
            <button className="action-btn danger" onClick={handleDelete} disabled={loading}>
              ✕ 删除报告
            </button>
            <button className="action-btn" onClick={handleBack}>
              ← 返回上一层
            </button>
          </div>
        </div>

        {loading && <p>加载中...</p>}
        {error && <div className="alert error">{error}</div>}

        {!loading && !error && report && (
          <>
            {/* 元数据折叠按钮 */}
            <div className="metadata-toggle">
              <button className="secondary-btn" onClick={() => setShowMetadata(!showMetadata)}>
                {showMetadata ? '隐藏技术信息' : '显示技术信息（报告信息、任务、版本等）'}
              </button>
            </div>

            {/* 可折叠的元数据部分 */}
            {showMetadata && (
              <>
                <section className="section">
                  <h3>报告信息</h3>
                  <div className="grid">
                    <div>
                      <p className="label">报告 ID</p>
                      <p className="value">{report.report_id}</p>
                    </div>
                    <div>
                      <p className="label">region_id</p>
                      <p className="value">{report.region_id}</p>
                    </div>
                    <div>
                      <p className="label">年份</p>
                      <p className="value">{report.year}</p>
                    </div>
                  </div>
                </section>

                <section className="section">
                  <h3>最新任务</h3>
                  {renderJobDetail(report.latest_job)}
                </section>

                <section className="section">
                  <h3>生效版本</h3>
                  {report.active_version ? (
                    <div className="grid">
                      <div>
                        <p className="label">版本 ID</p>
                        <p className="value">{report.active_version.version_id}</p>
                      </div>
                      <div>
                        <p className="label">模型</p>
                        <p className="value">{report.active_version.model || '—'}</p>
                      </div>
                      <div>
                        <p className="label">Provider</p>
                        <p className="value">{report.active_version.provider || '—'}</p>
                      </div>
                      <div>
                        <p className="label">Prompt 版本</p>
                        <p className="value">{report.active_version.prompt_version || '—'}</p>
                      </div>
                      <div>
                        <p className="label">Schema 版本</p>
                        <p className="value">{report.active_version.schema_version || '—'}</p>
                      </div>
                      <div>
                        <p className="label">创建时间</p>
                        <p className="value">{report.active_version.created_at || '—'}</p>
                      </div>
                      <div className="full-row">
                        <p className="label">文件路径</p>
                        <p className="value">{report.active_version.storage_path || '—'}</p>
                      </div>
                      <div className="full-row">
                        <p className="label">文本路径</p>
                        <p className="value">{report.active_version.text_path || '—'}</p>
                      </div>
                      <div className="full-row">
                        <p className="label">文件哈希</p>
                        <p className="value">{report.active_version.file_hash || '—'}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="meta">暂无生效版本</p>
                  )}
                </section>

                {/* 折叠式版本历史 */}
                <section className="section">
                  <div
                    className="version-history-header"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                    onClick={async () => {
                      const newShow = !showVersionHistory;
                      setShowVersionHistory(newShow);
                      // 懒加载：第一次展开时才加载
                      if (newShow && !versionHistory) {
                        setVersionsLoading(true);
                        try {
                          const resp = await apiClient.get(`/reports/${reportId}/versions`);
                          setVersionHistory(resp.data?.data || []);
                        } catch (err) {
                          console.error('Failed to fetch version history:', err);
                          setVersionHistory([]);
                        } finally {
                          setVersionsLoading(false);
                        }
                      }
                    }}
                  >
                    <span style={{ marginRight: '8px' }}>{showVersionHistory ? '▼' : '▶'}</span>
                    <h3 style={{ margin: 0 }}>
                      历史版本 {versionHistory ? `(${versionHistory.length})` : ''}
                    </h3>
                  </div>
                  {showVersionHistory && (
                    <div className="version-history-content" style={{ marginTop: '12px' }}>
                      {versionsLoading ? (
                        <p>加载中...</p>
                      ) : versionHistory && versionHistory.length > 0 ? (
                        <div
                          className="versions-list"
                          style={{ maxHeight: '300px', overflowY: 'auto' }}
                        >
                          {versionHistory.map((v) => (
                            <div
                              key={v.id}
                              className="version-item"
                              style={{
                                padding: '10px',
                                marginBottom: '8px',
                                borderRadius: '6px',
                                background: v.is_active ? '#1a3a2a' : '#1e1e1e',
                                border: v.is_active ? '1px solid #2ecc71' : '1px solid #333',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                }}
                              >
                                <div>
                                  <span
                                    style={{
                                      fontWeight: 'bold',
                                      color: v.is_active ? '#2ecc71' : '#ccc',
                                    }}
                                  >
                                    #{v.id} {v.is_active && '✓ 当前'}
                                  </span>
                                  <span
                                    style={{ marginLeft: '10px', color: '#888', fontSize: '12px' }}
                                  >
                                    {v.prompt_version || 'v1'}
                                  </span>
                                </div>
                                <span style={{ color: '#888', fontSize: '12px' }}>
                                  {new Date(v.created_at).toLocaleString()}
                                </span>
                              </div>
                              <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                                {v.file_name}
                              </div>
                              {!v.is_active && (
                                <button
                                  style={{
                                    marginTop: '8px',
                                    padding: '4px 12px',
                                    fontSize: '12px',
                                    background: '#2c3e50',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                  }}
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (!window.confirm(`确认将版本 #${v.id} 设为当前版本？`))
                                      return;
                                    try {
                                      await apiClient.post(
                                        `/reports/${reportId}/versions/${v.id}/activate`
                                      );
                                      alert('版本切换成功，页面将刷新');
                                      window.location.reload();
                                    } catch (err) {
                                      alert(
                                        '切换失败：' + (err.response?.data?.error || err.message)
                                      );
                                    }
                                  }}
                                >
                                  设为当前
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="meta">无历史版本</p>
                      )}
                    </div>
                  )}
                </section>
              </>
            )}

            {/* Tab 切换 */}
            <div className="tabs-container">
              <div className="tabs">
                <button
                  className={`tab ${activeTab === 'content' ? 'active' : ''}`}
                  onClick={() => setActiveTab('content')}
                >
                  ◈ 年报内容
                </button>
                <button
                  className={`tab ${activeTab === 'checks' ? 'active' : ''}`}
                  onClick={() => setActiveTab('checks')}
                >
                  ⬡ 勾稽关系校验
                </button>
                <button
                  className={`tab ${activeTab === 'quality' ? 'active' : ''}`}
                  onClick={() => setActiveTab('quality')}
                >
                  ◉ 数据质量审计
                </button>
              </div>
            </div>

            {/* Tab 内容 */}
            {activeTab === 'content' && (
              <section className="section">
                <div className="report-title-banner">
                  <h2>
                    {report?.year || ''}年{report?.region_name || report?.region?.name || ''}
                    政务公开年报
                  </h2>
                </div>
                {renderParsedContent(normalizedParsedJson)}
              </section>
            )}

            {activeTab === 'checks' && (
              <section className="section">
                {/* <h3>一致性校验</h3> Use header inside component */}
                <ConsistencyCheckView
                  reportId={reportId}
                  filterGroups={['table2', 'table3', 'table4', 'text']}
                  onLocate={handleLocateIssue}
                  onEdit={(paths) => {
                    const editData = {
                      data: normalizedParsedJson,
                      highlightPaths: paths || [],
                    };
                    setEditingData(editData);
                  }}
                />
              </section>
            )}

            {activeTab === 'quality' && (
              <section className="section">
                <ConsistencyCheckView
                  reportId={reportId}
                  filterGroups={['visual', 'structure', 'quality']}
                  onEdit={(paths) => {
                    const editData = {
                      data: normalizedParsedJson,
                      highlightPaths: paths || [],
                    };
                    setEditingData(editData);
                  }}
                />
              </section>
            )}
          </>
        )}
      </div>

      {/* 编辑器覆盖层 - 放在最外层以确保任何标签页下都能显示 */}
      {editingData && (
        <div className="editor-overlay">
          <div className="editor-modal">
            <ParsedDataEditor
              reportId={reportId}
              versionId={report.active_version?.version_id}
              parsedJson={editingData.data || editingData}
              highlightPaths={editingData.highlightPaths}
              onSave={handleSaveEdit}
              onCancel={handleCancelEdit}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default ReportDetail;
