import React, { useEffect, useState } from 'react';
import './ReportDetail.css';
import { apiClient, getCurrentUser } from '../apiClient';
import { Table2View, Table3View, Table4View } from './TableViews';
import { normalizeTablePath } from '../utils/tableRowColMapping';
import { buildTable3TraceModel } from '../utils/reportTrace';
import { normalizeConsistencyGroups } from '../utils/consistencyDisplay';
import { buildEvidenceViewModel } from '../utils/evidenceViewModel';
import { aggregateIssuesFromChecks } from '../utils/issueAggregation';
import ParsedDataEditor from './ParsedDataEditor';
import ConsistencyCheckView from './ConsistencyCheckView';
import VisionReviewPanel from './VisionReviewPanel';
import Button from './common/Button';
import PageHeader from './common/PageHeader';
import ReportFlowStatusBar from './ReportFlowStatusBar';
import { useToast } from './common/ToastProvider';
import { useConfirmDialog } from './common/ConfirmDialogProvider';
import { useTaskDrawer } from './tasks/TaskDrawerProvider';
import { resolveSafeReturnTo } from '../app/returnTo';

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

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const getErrorMessage = (err, fallback = '请求失败') =>
  err?.response?.data?.error || err?.message || fallback;

const EVIDENCE_SEVERITY_LABELS = {
  high: '高风险',
  medium: '需复核',
  low: '线索不足',
  info: '来源说明',
};

const DISPLAY_TEXT_THRESHOLD = 100;
const TABLE_SECTION_TYPES = new Set(['table_2', 'table_3', 'table_4']);
const DISPLAY_TEXT_KEYS = new Set(['content', 'text']);
const DISPLAY_STRUCTURED_KEYS = new Set(['sections', 'subsections', 'children', 'items', 'content', 'paragraphs']);
const DISPLAY_TABLE_DATA_KEYS = new Set([
  'activeDisclosureData',
  'tableData',
  'reviewLitigationData',
  'tables',
]);
const DISPLAY_METADATA_KEYS = new Set([
  'type',
  'title',
  'file_hash',
  'file_size',
  'report_id',
  'version_id',
  'generated_at',
  'storage_path',
  'visual_audit',
]);
const REPORT_DETAIL_DEBUG =
  process.env.NODE_ENV !== 'production' && process.env.REACT_APP_REPORT_DETAIL_DEBUG === '1';
const EMPTY_TABLE_TEXT_VALUES = new Set([
  '',
  '0',
  '0.0',
  '0.00',
  '/',
  '-',
  '--',
  '\u2014',
  '\u65e0',
  '\u6682\u65e0',
  'null',
  'undefined',
]);
const EMPTY_SOURCE_TABLE_NOTICE =
  '\u539f\u59cb\u6587\u4ef6\u6ca1\u6709\u6709\u6548\u6b63\u6587\uff0c\u7cfb\u7edf\u5df2\u9690\u85cf\u7531\u7a7a\u6a21\u677f\u751f\u6210\u7684\u8868\u683c\uff1b\u8bf7\u4e0a\u4f20\u5305\u542b\u6b63\u6587\u6216\u9644\u4ef6\u5185\u5bb9\u7684\u62a5\u544a\u540e\u91cd\u65b0\u89e3\u6790\u3002';
const NO_VALID_CONTENT_NOTICE =
  '\u5f53\u524d\u62a5\u544a\u6ca1\u6709\u53ef\u5c55\u793a\u7684\u6b63\u6587\u6216\u8868\u683c\u6570\u636e\uff0c\u8bf7\u68c0\u67e5\u539f\u59cb\u6587\u4ef6\u540e\u91cd\u65b0\u4e0a\u4f20\u3002';

const isMeaningfulDisplayTableValue = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const compact = trimmed.replace(/[,，\s]/g, '');
    if (EMPTY_TABLE_TEXT_VALUES.has(trimmed) || EMPTY_TABLE_TEXT_VALUES.has(compact)) {
      return false;
    }
    const numeric = Number(compact);
    return !Number.isFinite(numeric) || numeric !== 0;
  }
  if (typeof value === 'boolean') return value;
  return false;
};

const hasMeaningfulDisplayTableData = (node) => {
  if (Array.isArray(node)) {
    return node.some(hasMeaningfulDisplayTableData);
  }

  if (!node || typeof node !== 'object') {
    return isMeaningfulDisplayTableValue(node);
  }

  return Object.values(node).some((value) => hasMeaningfulDisplayTableData(value));
};

const getSectionTablePayload = (section) => {
  if (!section || typeof section !== 'object') return null;
  if (section.type === 'table_2') return section.activeDisclosureData;
  if (section.type === 'table_3') return section.tableData;
  if (section.type === 'table_4') return section.reviewLitigationData;
  return null;
};

const hasMeaningfulParsedTableData = (parsed) => {
  if (!parsed || typeof parsed !== 'object') return false;

  if (Array.isArray(parsed.sections)) {
    return parsed.sections.some((section) => hasMeaningfulDisplayTableData(getSectionTablePayload(section)));
  }

  return (
    hasMeaningfulDisplayTableData(parsed.activeDisclosureData) ||
    hasMeaningfulDisplayTableData(parsed.tableData) ||
    hasMeaningfulDisplayTableData(parsed.reviewLitigationData) ||
    hasMeaningfulDisplayTableData(parsed.tables)
  );
};

const getDisplayNarrativeTextLength = (node, parentKey = '') => {
  if (node === null || node === undefined) return 0;

  if (typeof node === 'string') {
    return DISPLAY_TEXT_KEYS.has(parentKey) ? node.trim().length : 0;
  }

  if (Array.isArray(node)) {
    return node.reduce((sum, item) => sum + getDisplayNarrativeTextLength(item, parentKey), 0);
  }

  if (typeof node !== 'object') return 0;

  return Object.entries(node).reduce((sum, [key, value]) => {
    if (DISPLAY_METADATA_KEYS.has(key) || DISPLAY_TABLE_DATA_KEYS.has(key)) {
      return sum;
    }

    if (
      DISPLAY_STRUCTURED_KEYS.has(key) ||
      DISPLAY_TEXT_KEYS.has(key) ||
      parentKey === 'sections' ||
      parentKey === 'subsections' ||
      parentKey === 'paragraphs' ||
      parentKey === 'content'
    ) {
      return sum + getDisplayNarrativeTextLength(value, key);
    }

    return sum;
  }, 0);
};

const getDisplayContentQuality = (parsed, versionQuality) => {
  const parsedTextLength = getDisplayNarrativeTextLength(parsed);
  const hasMeaningfulTableData = hasMeaningfulParsedTableData(parsed);
  const suppressByVersionQuality = Boolean(versionQuality?.suppress_display_tables);

  return {
    suppressAllTables: suppressByVersionQuality,
    suppressTables:
      suppressByVersionQuality ||
      (parsedTextLength < DISPLAY_TEXT_THRESHOLD && !hasMeaningfulTableData),
  };
};

const shouldSuppressDisplayTableSection = (section, displayQuality) =>
  TABLE_SECTION_TYPES.has(section?.type) &&
  (displayQuality?.suppressAllTables ||
    (displayQuality?.suppressTables &&
      !hasMeaningfulDisplayTableData(getSectionTablePayload(section))));

const getUserCanMaintainReports = (user) =>
  Boolean(
    user &&
      (user.permissions?.upload_reports ||
        user.permissions?.delete_reports ||
        user.permissions?.manage_jobs)
  );

const stripLeadingSectionTitle = (content, title) => {
  if (typeof content !== 'string') return content;
  const normalizedTitle = String(title || '').trim();
  const normalizedContent = content.trim();
  if (!normalizedTitle || !normalizedContent.startsWith(normalizedTitle)) {
    return content;
  }
  return normalizedContent.slice(normalizedTitle.length).trimStart();
};

const splitReportTextBlocks = (content) => {
  if (typeof content !== 'string') return [];
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const baseBlocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return baseBlocks.flatMap((block) => {
    const markerRegex = /（[一二三四五六七八九十]+）/g;
    const matches = [...block.matchAll(markerRegex)];
    if (matches.length === 0) return [block];

    const parts = [];
    let cursor = 0;
    matches.forEach((match, index) => {
      const markerStart = match.index ?? 0;
      if (markerStart > cursor) {
        const before = block.slice(cursor, markerStart).trim();
        if (before) parts.push(before);
      }

      const nextMarkerStart = matches[index + 1]?.index ?? block.length;
      const subsectionBlock = block.slice(markerStart, nextMarkerStart).trim();
      if (subsectionBlock) parts.push(subsectionBlock);
      cursor = nextMarkerStart;
    });

    if (cursor < block.length) {
      const tail = block.slice(cursor).trim();
      if (tail) parts.push(tail);
    }
    return parts;
  });
};

const getReportSubsectionParts = (block) => {
  const normalized = String(block || '').trim();
  if (!/^（[一二三四五六七八九十]+）/.test(normalized)) return null;

  const marker = normalized.match(/^（[一二三四五六七八九十]+）/)?.[0] || '';
  const markerEnd = marker.length;
  const headingSearch = normalized.slice(markerEnd, Math.min(normalized.length, markerEnd + 48));
  const titleEndingIndex = headingSearch.indexOf('情况');
  let headingEnd = titleEndingIndex >= 0 ? markerEnd + titleEndingIndex + 2 : -1;

  if (headingEnd < 0) {
    const separatorMatch = normalized.slice(markerEnd).match(/[\s，,。；;]/);
    if (separatorMatch?.index !== undefined && separatorMatch.index > 0) {
      headingEnd = markerEnd + separatorMatch.index;
    }
  }

  if (headingEnd <= markerEnd || headingEnd > markerEnd + 48) return null;

  return {
    heading: normalized.slice(0, headingEnd),
    rest: normalized.slice(headingEnd),
  };
};

const getReportTextBlockClass = (block) => {
  if (getReportSubsectionParts(block)) return 'report-paragraph report-subsection-block';
  return 'report-paragraph';
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
  target[path[path.length - 1]] = value ?? null;
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

const toNumberValue = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toNullableNumberValue = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const createTable2Skeleton = () => ({
  regulations: { made: 0, repealed: 0, valid: 0 },
  normativeDocuments: { made: 0, repealed: 0, valid: 0 },
  licensing: { processed: 0 },
  punishment: { processed: 0 },
  coercion: { processed: 0 },
  fees: { amount: 0 },
});

const createTable4Skeleton = () => ({
  review: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
  litigationDirect: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
  litigationPostReview: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
});

const buildTable2FromFacts = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const data = createTable2Skeleton();
  const categoryMap = {
    regulations: 'regulations',
    normative_documents: 'normativeDocuments',
    licensing: 'licensing',
    punishment: 'punishment',
    coercion: 'coercion',
    fees: 'fees',
  };

  rows.forEach((row) => {
    const targetKey = categoryMap[row?.category];
    if (!targetKey) return;
    if (targetKey === 'regulations' || targetKey === 'normativeDocuments') {
      data[targetKey] = {
        made: toNumberValue(row?.made_count, 0),
        repealed: toNumberValue(row?.repealed_count, 0),
        valid: toNumberValue(row?.valid_count, 0),
      };
      return;
    }
    if (targetKey === 'fees') {
      data.fees = { amount: toNumberValue(row?.amount, 0) };
      return;
    }
    data[targetKey] = { processed: toNumberValue(row?.processed_count, 0) };
  });

  return data;
};

const buildTable3FromFacts = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const data = createTable3Skeleton();

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

  rows.forEach((row) => {
    const applicantPath = applicantPathMap[row?.applicant_type];
    const responsePath = responsePathMap[row?.response_type];
    if (!applicantPath || !responsePath) return;
    setNested(data, [...applicantPath, ...responsePath], toNullableNumberValue(row?.count));
  });

  return data;
};

const buildTable4FromFacts = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const data = createTable4Skeleton();
  const caseTypeMap = {
    review: 'review',
    litigation_direct: 'litigationDirect',
    litigation_post_review: 'litigationPostReview',
  };
  const resultTypeMap = {
    maintain: 'maintain',
    correct: 'correct',
    other: 'other',
    unfinished: 'unfinished',
    total: 'total',
  };

  rows.forEach((row) => {
    const caseType = caseTypeMap[row?.case_type];
    const resultType = resultTypeMap[row?.result_type];
    if (!caseType || !resultType) return;
    data[caseType][resultType] = toNullableNumberValue(row?.count);
  });

  return data;
};

const buildParsedFromFacts = (factsPayload) => {
  if (!factsPayload || typeof factsPayload !== 'object') return null;

  const table2 = buildTable2FromFacts(factsPayload.activeDisclosure);
  const table3 = buildTable3FromFacts(factsPayload.application);
  const table4 = buildTable4FromFacts(factsPayload.legalProceeding);

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

  if (sections.length === 0) return null;
  return { sections };
};

const buildDisplayParsedJson = (factsPayload, parsedPayload) => {
  const factsParsed = buildParsedFromFacts(factsPayload);
  const normalizedParsed = normalizeParsedPayload(parsedPayload);

  const parsedSections = Array.isArray(normalizedParsed?.sections) ? normalizedParsed.sections : [];
  const factSections = Array.isArray(factsParsed?.sections) ? factsParsed.sections : [];

  const tableTypes = new Set(['table_2', 'table_3', 'table_4']);

  const parsedTextSections = parsedSections.filter((section) => section?.type === 'text');

  const parsedOtherSections = parsedSections.filter(
    (section) => section && !tableTypes.has(section.type) && section.type !== 'text'
  );

  const parsedTableTitleByType = new Map(
    parsedSections
      .filter((section) => section && tableTypes.has(section.type))
      .map((section) => [section.type, section.title])
  );

  const factTableSections = factSections.map((section) => ({
    ...section,
    title: parsedTableTitleByType.get(section.type) || section.title,
  }));

  const hasFactTables = factTableSections.length > 0;

  if (!hasFactTables) {
    return {
      parsed: normalizedParsed || null,
      usingFactsSource: false,
    };
  }

  const mergedSections = [...parsedTextSections, ...factTableSections, ...parsedOtherSections];

  const mergedParsed =
    normalizedParsed && typeof normalizedParsed === 'object'
      ? { ...normalizedParsed, sections: mergedSections }
      : { sections: mergedSections };

  return {
    parsed: mergedParsed,
    usingFactsSource: true,
  };
};

const applyPendingOcrCorrections = (parsed, corrections = []) => {
  const pending = (corrections || []).filter((item) => item?.status === 'pending');
  if (!parsed || pending.length === 0) return parsed;

  const next = JSON.parse(JSON.stringify(parsed));
  const findSection = (payloadKey) => {
    if (Array.isArray(next.sections)) {
      const section = next.sections.find((item) => item && typeof item === 'object' && item[payloadKey]);
      if (section) return section;
    }
    return next;
  };

  pending.forEach((correction) => {
    const parts = String(correction.fieldPath || '').split('.').filter(Boolean);
    const payloadKey = parts.shift();
    if (!payloadKey) return;
    const section = findSection(payloadKey);
    if (!section[payloadKey] || typeof section[payloadKey] !== 'object') section[payloadKey] = {};
    let target = section[payloadKey];
    for (let index = 0; index < parts.length - 1; index += 1) {
      const key = parts[index];
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      target = target[key];
    }
    target[parts[parts.length - 1]] = correction.ocrValue;
  });

  return next;
};

function ReportDetail({ reportId: propReportId, onBack }) {
  const toast = useToast();
  const taskDrawer = useTaskDrawer();
  const confirmAction = useConfirmDialog();
  const reportId = propReportId || window.location.pathname.split('/').pop();
  const currentUser = getCurrentUser();
  const canMaintainReports = getUserCanMaintainReports(currentUser);
  const isDevDebugEnv = process.env.NODE_ENV !== 'production';
  // Technical diagnostics stay opt-in via URL so the formal report view is clean by default.
  const technicalModeEnabled =
    isDevDebugEnv &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === 'true';
  const [report, setReport] = useState(null);
  const [factsPayload, setFactsPayload] = useState(null);
  const [factsLoadError, setFactsLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showParsed, setShowParsed] = useState(true); // 默认展开
  const [showMetadata, setShowMetadata] = useState(false); // 元数据默认隐藏
  const [editingData, setEditingData] = useState(null); // 编辑模式
  const [activeTab, setActiveTab] = useState('content'); // 'content' | 'checks'
  const [highlightCells, setHighlightCells] = useState([]); // 勾稽问题单元格路径
  const [visionReviews, setVisionReviews] = useState([]);
  const [ocrCorrections, setOcrCorrections] = useState([]);
  const [highlightTexts, setHighlightTexts] = useState([]); // 勾稽问题文本
  const [focusedCheck, setFocusedCheck] = useState(null); // 当前定位的勾稽问题
  const [focusedCells, setFocusedCells] = useState([]); // 定位模式下的单元格路径
  const [qualityIssues, setQualityIssues] = useState({}); // 质量审计问题 { sec5: [...], sec6: [...] }
  const [table3Issues, setTable3Issues] = useState([]); // 表三勾稽异常（来自后端 /checks）
  const [table4Issues, setTable4Issues] = useState([]); // 表四勾稽异常（来自后端 /checks）
  const [showVersionHistory, setShowVersionHistory] = useState(false); // 版本历史折叠
  const [versionHistory, setVersionHistory] = useState(null); // 历史版本列表数据
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [showParseHistory, setShowParseHistory] = useState(false);
  const [parseHistory, setParseHistory] = useState(null);
  const [parseHistoryLoading, setParseHistoryLoading] = useState(false);
  const [parseHistoryError, setParseHistoryError] = useState('');
  const [parseActionId, setParseActionId] = useState(null);
  const [showTracePanel, setShowTracePanel] = useState(false);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState('');
  const [traceData, setTraceData] = useState(null);
  const [table2Issues, setTable2Issues] = useState([]);
  const isTablePath = (p) =>
    p &&
    (p.includes('tableData') ||
      p.includes('reviewLitigationData') ||
      p.includes('activeDisclosureData'));

  const handleBack = () => {
    if (onBack) return onBack();
    window.location.href = resolveSafeReturnTo(window.location.search, '/catalog');
  };

  const fetchFacts = async (targetReportId, versionId) => {
    const params = versionId ? { params: { version_id: versionId } } : undefined;
    const [activeDisclosure, application, legalProceeding] = await Promise.all([
      apiClient.get(`/v2/reports/${targetReportId}/facts/active_disclosure`, params),
      apiClient.get(`/v2/reports/${targetReportId}/facts/application`, params),
      apiClient.get(`/v2/reports/${targetReportId}/facts/legal_proceeding`, params),
    ]);

    return {
      activeDisclosure: activeDisclosure.data?.data ?? [],
      application: application.data?.data ?? [],
      legalProceeding: legalProceeding.data?.data ?? [],
    };
  };

  const fetchFlowSignals = async (targetReportId, payload) => {
    const regionId = payload?.region_id;
    const year = payload?.year;
    if (!targetReportId || !regionId || !year) return {};

    try {
      const comparisonsResp = await apiClient.get('/comparisons/history', {
        params: {
          region_id: regionId,
          year,
          pageSize: 20,
        },
      });
      const comparisons = comparisonsResp.data?.data || [];
      const relatedComparison = comparisons.find((item) => {
        const leftId = String(item.leftReportId ?? '');
        const rightId = String(item.rightReportId ?? '');
        return leftId === String(targetReportId) || rightId === String(targetReportId);
      }) || null;

      if (!relatedComparison) {
        return {};
      }

      const jobsResp = await apiClient.get('/pdf-jobs', {
        params: { limit: 100 },
      });
      const jobs = jobsResp.data?.jobs || [];
      const completedJob = jobs.find((job) =>
        String(job.comparison_id ?? '') === String(relatedComparison.id) &&
        String(job.status || '').toLowerCase() === 'done' &&
        job.file_exists
      ) || null;

      return {
        latestComparison: relatedComparison,
        latestCompletedPdfJob: completedJob,
      };
    } catch (err) {
      return {};
    }
  };

  const loadFlowSignals = async (targetReportId, payload) => {
    const flowSignals = await fetchFlowSignals(targetReportId, payload);
    if (!flowSignals.latestComparison && !flowSignals.latestCompletedPdfJob) return;
    setReport((prevReport) => {
      if (!prevReport || String(prevReport.report_id) !== String(targetReportId)) return prevReport;
      return { ...prevReport, flow_signals: flowSignals };
    });
  };

  const loadReportAndFacts = async (targetReportId, { errorPrefix = '加载报告详情失败' } = {}) => {
    if (!targetReportId) return;

    setLoading(true);
    setError('');
    setFactsLoadError('');
    setFactsPayload(null);
    try {
      const detailResponse = await apiClient.get(`/reports/${targetReportId}`);
      const payload = detailResponse.data?.data ?? detailResponse.data?.report ?? detailResponse.data;
      setReport(payload || null);
      const workingVersionId =
        payload?.pending_review_version?.version_id || payload?.active_version?.version_id || null;
      loadFlowSignals(targetReportId, payload || {});

      try {
        const facts = await fetchFacts(targetReportId, workingVersionId);
        setFactsPayload(facts);
      } catch (factsErr) {
        setFactsPayload(null);
        setFactsLoadError(`facts 加载失败：${getErrorMessage(factsErr)}。当前不展示 parsed_json。`);
      }
    } catch (err) {
      setError(`${errorPrefix}：${getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const loadVersionHistory = async (targetReportId = reportId) => {
    if (!targetReportId) return;

    setVersionsLoading(true);
    try {
      const resp = await apiClient.get(`/reports/${targetReportId}/versions`);
      setVersionHistory(resp.data?.data || []);
    } catch (err) {
      console.error('Failed to fetch version history:', err);
      setVersionHistory([]);
    } finally {
      setVersionsLoading(false);
    }
  };

  const loadParseHistory = async (targetReportId = reportId, targetVersionId = workingVersionId) => {
    if (!targetReportId) return;

    setParseHistoryLoading(true);
    setParseHistoryError('');
    try {
      const params = targetVersionId ? { params: { version_id: targetVersionId } } : undefined;
      const resp = await apiClient.get(`/reports/${targetReportId}/parse-history`, params);
      setParseHistory(resp.data?.parse_runs || []);
    } catch (err) {
      console.error('Failed to fetch parse history:', err);
      setParseHistory([]);
      setParseHistoryError(getErrorMessage(err, '解析历史加载失败'));
    } finally {
      setParseHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadReportAndFacts(reportId, { errorPrefix: '加载报告详情失败' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  useEffect(() => {
    setFocusedCheck(null);
    setFocusedCells([]);
  }, [reportId]);

  // 获取勾稽校验问题数据用于高亮
  const fetchHighlights = async (targetVersionId) => {
    if (!reportId || !targetVersionId) return;
    try {
      const response = await apiClient.get(`/reports/${reportId}/checks`, {
        params: { version_id: targetVersionId },
      });
      const data = response.data?.data || response.data;
      const groups = normalizeConsistencyGroups(data?.groups || []);
      const aggregation = aggregateIssuesFromChecks(groups, {
        domain: 'consistency',
        displayMode: 'content',
        includeUncertain: true,
        includeConfirmed: true,
        includeDismissed: true,
        displayNoScope: 'group',
      });

      if (REPORT_DETAIL_DEBUG) {
        console.log('[DEBUG ReportDetail] Fetched checks data:', data);
      }

      // 提取未确认的问题路径
      const cellPaths = [];
      const textInfos = [];
      const sec5Issues = [];
      const sec6Issues = [];
      const t2Issues = (aggregation.issuesByGroupKey.table2 || []).filter(
        (item) =>
          (item.autoStatus === 'FAIL' || item.autoStatus === 'UNCERTAIN') &&
          item.humanStatus !== 'dismissed'
      ); // 表二勾稽问题与待复核提示
      const t3Issues = (aggregation.issuesByGroupKey.table3 || []).filter(
        (item) => item.autoStatus === 'FAIL' && item.humanStatus !== 'dismissed'
      ); // 表三勾稽问题
      const t4Issues = (aggregation.issuesByGroupKey.table4 || []).filter(
        (item) => item.autoStatus === 'FAIL' && item.humanStatus !== 'dismissed'
      ); // 表四勾稽问题

      groups.forEach((group) => {
        (group.items || []).forEach((item) => {
          // dismissed 直接跳过；confirmed 保留用于视觉降噪展示
          if (item.human_status === 'dismissed') return;
          if (
            item.auto_status === 'FAIL' ||
            item.auto_status === 'UNCERTAIN' ||
            item.human_status === 'confirmed'
          ) {
            const groupKey = group.groupKey || group.group_key;
            const isConfirmedItem = item.human_status === 'confirmed';

            // 提取质量审计问题（Section 5/6）
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
                if (isTablePath(normalized)) {
                  cellPaths.push({ path: normalized, type: 'left', confirmed: isConfirmedItem, humanStatus: item.human_status });
                }
              });
              rightPaths.forEach((p) => {
                const normalized = normalizeTablePath(p);
                if (isTablePath(normalized)) {
                  cellPaths.push({ path: normalized, type: 'right', confirmed: isConfirmedItem, humanStatus: item.human_status });
                }
              });
            } else {
              // Fallback for logic without split paths
              allPaths.forEach((p) => {
                const normalized = normalizeTablePath(p);
                if (isTablePath(normalized)) {
                  cellPaths.push({ path: normalized, type: 'diff', confirmed: isConfirmedItem, humanStatus: item.human_status });
                }
              });
            }

            // Text Info extraction
            allPaths.forEach((p) => {
              if (p.includes('text') || p.includes('content')) {
                const textValue = item.evidence?.values?.textValue;
                if (textValue) {
                  textInfos.push({
                    value: textValue,
                    context: item.evidence?.values?.context,
                    matchedText: item.evidence?.values?.matchedText,
                    sectionIndex: item.evidence?.values?.sectionIndex,
                  });
                }
              }
            });
          }
        });
      });

      if (REPORT_DETAIL_DEBUG) {
        console.log('[DEBUG ReportDetail] Final cellPaths:', cellPaths);
        console.log('[DEBUG ReportDetail] Final textInfos:', textInfos);
        console.log('[DEBUG ReportDetail] Quality issues - Sec5:', sec5Issues, 'Sec6:', sec6Issues);
      }
      setHighlightCells(cellPaths);
      setHighlightTexts(textInfos);
      setQualityIssues({ sec5: sec5Issues, sec6: sec6Issues });
      setTable2Issues(t2Issues);
      setTable3Issues(t3Issues);
      setTable4Issues(t4Issues);
    } catch (err) {
      console.error('Failed to fetch highlights:', err);
    }
  };

  const buildFocusCells = (leftPaths = [], rightPaths = [], fallbackPaths = []) => {
    const toCells = (paths, type) =>
      (paths || [])
        .map((p) => normalizeTablePath(p))
        .filter((p) => p && isTablePath(p))
        .map((path) => ({ path, type, scope: 'focus' }));

    return [
      ...toCells(leftPaths, 'left'),
      ...toCells(rightPaths, 'right'),
      ...toCells(fallbackPaths, 'diff'),
    ];
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

  const handleLocateIssue = ({ item, title, leftPaths = [], rightPaths = [], fallbackPaths = [] }) => {
    const fallbackTargets = (fallbackPaths || [])
      .map((p) => normalizeTablePath(p))
      .filter((p) => p && isTablePath(p));
    const focusCells = buildFocusCells(leftPaths, rightPaths, fallbackTargets);

    if (focusCells.length === 0 && fallbackTargets.length === 0) return;

    if (focusCells.length > 0) {
      const evidenceModel = buildEvidenceViewModel(
        item || {
          auto_status: 'UNCERTAIN',
          title,
          evidence: { leftPaths, rightPaths, paths: fallbackTargets },
        }
      );
      setFocusedCheck({ title: title || '勾稽关系定位', evidenceModel });
      setFocusedCells(focusCells);
    } else {
      setFocusedCheck(null);
      setFocusedCells([]);
    }
    setActiveTab('content');
    setShowParsed(true);
    scrollToFirstCell(leftPaths.length > 0 ? leftPaths : rightPaths.length > 0 ? rightPaths : fallbackTargets);
  };

  const clearFocus = () => {
    setFocusedCheck(null);
    setFocusedCells([]);
  };

  const pendingVersion = report?.pending_review_version || null;
  const activeVersion = report?.active_version || null;
  const workingVersion = pendingVersion || activeVersion || null;
  const workingVersionId = workingVersion?.version_id || null;
  const hasPendingReview = Boolean(pendingVersion);

  useEffect(() => {
    setTraceData(null);
    setTraceError('');
  }, [reportId, workingVersionId]);

  // 加载报告时同时获取高亮数据
  useEffect(() => {
    if (reportId && workingVersionId) {
      fetchHighlights(workingVersionId);
      if (activeTab !== 'visionReview') {
        fetchOcrCorrections(workingVersionId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, activeTab, workingVersionId]); // activeTab 变化时也刷新

  const loadTraceData = async (targetReportId = reportId, targetVersionId = workingVersionId) => {
    if (!targetReportId || !targetVersionId) return;

    setTraceLoading(true);
    setTraceError('');

    const [sourceResult, cellsResult] = await Promise.allSettled([
      apiClient.get(`/reports/${targetReportId}/source-text`, {
        params: { version_id: targetVersionId, full: 1 },
      }),
      apiClient.get(`/v2/reports/${targetReportId}/cells`, {
        params: { version_id: targetVersionId, table_id: 'application', limit: 500 },
      }),
    ]);

    const nextTraceData = {
      reportId: targetReportId,
      versionId: targetVersionId,
      sourceMeta: null,
      sourceText: '',
      cells: [],
    };
    const errorParts = [];

    if (sourceResult.status === 'fulfilled') {
      nextTraceData.sourceMeta = sourceResult.value.data || null;
      nextTraceData.sourceText = sourceResult.value.data?.content || '';
    } else {
      errorParts.push(`source_text：${getErrorMessage(sourceResult.reason)}`);
    }

    if (cellsResult.status === 'fulfilled') {
      nextTraceData.cells = cellsResult.value.data?.data || [];
    } else {
      errorParts.push(`cells：${getErrorMessage(cellsResult.reason)}`);
    }

    setTraceData(nextTraceData);
    if (errorParts.length > 0) {
      setTraceError(`部分证据加载失败：${errorParts.join('；')}`);
    }
    setTraceLoading(false);
  };

  useEffect(() => {
    if (technicalModeEnabled && showTracePanel && reportId && workingVersionId) {
      loadTraceData(reportId, workingVersionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [technicalModeEnabled, showTracePanel, reportId, workingVersionId]);

  const refresh = async () => {
    if (!reportId) return;
    await loadReportAndFacts(reportId, { errorPrefix: '刷新失败' });
    if (showVersionHistory) {
      await loadVersionHistory(reportId);
    }
    if (showParseHistory) {
      await loadParseHistory(reportId, workingVersionId);
    }
    if (technicalModeEnabled && showTracePanel && workingVersionId) {
      await loadTraceData(reportId, workingVersionId);
    }
  };

  const fetchOcrCorrections = async (targetVersionId = workingVersionId) => {
    if (!reportId || !targetVersionId) return;
    try {
      const response = await apiClient.get(`/reports/${reportId}/vision-review`, {
        params: { version_id: targetVersionId },
      });
      const data = response.data?.data || {};
      setVisionReviews(data.reviews || []);
      setOcrCorrections(data.corrections || []);
    } catch (err) {
      console.warn('Failed to fetch OCR corrections:', err);
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
    throw new Error('等待解析超时，请稍后重试');
  };

  const handleReparse = async () => {
    if (!reportId) return;
    const shouldReparse = await confirmAction({
      title: '重新触发解析',
      message: '确认重新触发解析吗？将创建新的 parse 任务。',
      confirmText: '重新解析',
      cancelText: '取消',
      tone: 'warning',
    });
    if (!shouldReparse) return;
    setError('');
    setLoading(true);
    try {
      const resp = await apiClient.post(
        `/reports/${reportId}/parse`,
        workingVersionId ? { version_id: workingVersionId } : {}
      );
      const jobId = resp.data?.job_id || resp.data?.jobId;

      if (!jobId) throw new Error('未返回有效 job_id');

      taskDrawer.trackParseJob({
        job_id: jobId,
        version_id: workingVersionId,
        report_id: reportId,
        status: 'queued',
        progress: 0,
        step_name: 'Reparse queued',
        file_name: report?.file_name,
      });
      taskDrawer.openDrawer();

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
    const shouldDelete = await confirmAction({
      title: '删除报告',
      message: `确认删除报告 #${reportId} 吗？`,
      confirmText: '删除',
      cancelText: '取消',
      tone: 'danger',
    });
    if (!shouldDelete) return;
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

  const handleParseAction = async (run, action) => {
    if (!reportId || !run?.id || !run?.report_version_id) return;

    const actionLabels = {
      switch: '切换当前解析',
      restore: '恢复历史解析',
      retry: '重试提交',
    };
    const label = actionLabels[action] || '执行操作';
    const shouldRun = await confirmAction({
      title: label,
      message: `确认${label} #${run.id} 吗？`,
      confirmText: '确认',
      cancelText: '取消',
      tone: action === 'switch' || action === 'restore' ? 'warning' : 'default',
    });
    if (!shouldRun) return;

    setParseActionId(`${action}:${run.id}`);
    setParseHistoryError('');
    try {
      if (action === 'switch') {
        await apiClient.post(`/reports/${reportId}/switch-current-parse`, {
          version_id: run.report_version_id,
          parse_run_id: run.id,
        });
      } else if (action === 'restore') {
        await apiClient.post(`/reports/${reportId}/restore-superseded-parse`, {
          version_id: run.report_version_id,
          parse_run_id: run.id,
        });
      } else if (action === 'retry') {
        await apiClient.post(`/reports/${reportId}/retry-finalize`, {
          parse_run_id: run.id,
        });
      }
      await refresh();
    } catch (err) {
      setParseHistoryError(`${label}失败：${getErrorMessage(err)}`);
    } finally {
      setParseActionId(null);
    }
  };

  const handleSaveEdit = (saveData) => {
    // Support both old format (direct data) and new format (object with parsedJson/newVersionId)
    const parsedJson = saveData?.parsedJson ?? saveData;
    const newVersionId = saveData?.newVersionId;

    setReport((prevReport) => {
      if (!prevReport) return prevReport;
      const nextPendingVersion = {
        ...(prevReport.pending_review_version || prevReport.active_version || {}),
        parsed_json: parsedJson,
        version_id:
          newVersionId ??
          prevReport.pending_review_version?.version_id ??
          prevReport.active_version?.version_id,
        review_status: 'pending_review',
        is_active: false,
      };
      return {
        ...prevReport,
        pending_review_version: nextPendingVersion,
      };
    });
    setEditingData(null);
    fetchHighlights(newVersionId ?? workingVersionId);
    refresh();
    // No need to alert here - ParsedDataEditor already shows alert
  };

  const handleCancelEdit = () => {
    setEditingData(null);
  };

  // 对文本中的问题数字进行高亮 - SECURITY FIX: Use safe React elements instead of dangerouslySetInnerHTML
  const highlightTextIssues = (text, highlights, sectionIndex) => {
    if (!highlights || highlights.length === 0 || !text) return text;

    const sourceText = String(text);
    const ranges = [];

    highlights.forEach((highlight) => {
      if (
        highlight?.sectionIndex &&
        sectionIndex &&
        Number(highlight.sectionIndex) !== Number(sectionIndex)
      ) {
        return;
      }

      const matchedText = typeof highlight?.matchedText === 'string' ? highlight.matchedText : '';
      if (matchedText) {
        const start = sourceText.indexOf(matchedText);
        if (start >= 0) {
          ranges.push({ start, end: start + matchedText.length });
          return;
        }
      }

      const context = typeof highlight?.context === 'string'
        ? highlight.context.replace(/^\.\.\./, '').replace(/\.\.\.$/, '')
        : '';
      const value = highlight?.value !== null && highlight?.value !== undefined
        ? String(highlight.value)
        : '';
      const contextStart = context ? sourceText.indexOf(context) : -1;
      if (contextStart >= 0 && value) {
        const valueMatch = context.match(new RegExp(`(?<!\\d)${escapeRegExp(value)}(?!\\d)`));
        if (valueMatch?.index !== undefined) {
          const start = contextStart + valueMatch.index;
          ranges.push({ start, end: start + value.length });
        }
      }
    });

    if (ranges.length === 0) return text;

    const mergedRanges = ranges
      .filter((range) => range.start >= 0 && range.end > range.start)
      .sort((left, right) => left.start - right.start)
      .reduce((acc, range) => {
        const last = acc[acc.length - 1];
        if (!last || range.start > last.end) {
          acc.push({ ...range });
        } else if (range.end > last.end) {
          last.end = range.end;
        }
        return acc;
      }, []);

    if (mergedRanges.length === 0) return text;

    const elements = [];
    let cursor = 0;
    mergedRanges.forEach((range, index) => {
      if (range.start > cursor) {
        elements.push(sourceText.slice(cursor, range.start));
      }
      elements.push(
        <mark key={`hl-${index}`} className="text-warning">
          {sourceText.slice(range.start, range.end)}
        </mark>
      );
      cursor = range.end;
    });
    if (cursor < sourceText.length) {
      elements.push(sourceText.slice(cursor));
    }

    return <span>{elements}</span>;
  };

  const isFocusMode = focusedCells.length > 0 && focusedCheck;
  const activeHighlightCells = isFocusMode ? focusedCells : highlightCells;
  const mergedDisplay = buildDisplayParsedJson(factsPayload, workingVersion?.parsed_json);
  const visibleOcrCorrections = ocrCorrections.filter((item) => item.status === 'pending');
  const pendingOcrCorrections = ocrCorrections.filter((item) => item.status === 'pending');
  const confirmedOcrCorrections = ocrCorrections.filter((item) => item.status === 'confirmed');
  const sourceTableAnomalyReviews = visionReviews.filter((item) => item.conclusion === 'source_table_anomaly');
  const inconclusiveVisionReviews = visionReviews.filter((item) => item.conclusion === 'inconclusive');
  const displayParsedJson = applyPendingOcrCorrections(mergedDisplay.parsed, pendingOcrCorrections);
  const usingFactsSource = mergedDisplay.usingFactsSource;
  const traceView = traceData
    ? buildTable3TraceModel({
        sourceText: traceData.sourceText,
        parsedPayload: workingVersion?.parsed_json,
        factsRows: factsPayload?.application,
        cellRows: traceData.cells,
        displayPayload: displayParsedJson,
        usingFactsSource,
      })
    : null;

  const renderParsedContent = (parsed) => {
    const normalized = normalizeParsedPayload(parsed);
    if (!normalized) return <p className="meta">暂无解析内容</p>;

    // 如果是对象且包含 sections，则渲染结构化内容
    if (
      normalized &&
      typeof normalized === 'object' &&
      normalized.sections &&
      Array.isArray(normalized.sections)
    ) {
      return renderStructuredContent(normalized);
    }

    // 否则显示原始 JSON
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

    // 对 sections 进行排序，将标题放在最前面
    const displayQuality = getDisplayContentQuality(parsed, workingVersion?.content_quality);
    const rawSections = parsed.sections.map((section, originalIndex) => ({
      ...section,
      __originalSectionIndex: originalIndex + 1,
    }));
    const suppressedTableCount = rawSections.filter((section) =>
      shouldSuppressDisplayTableSection(section, displayQuality)
    ).length;
    const sections = rawSections.filter(
      (section) => !shouldSuppressDisplayTableSection(section, displayQuality)
    );
    sections.sort((a, b) => {
      const titleA = String(a?.title || '');
      const titleB = String(b?.title || '');

      const isTitleA = titleA.includes('\u6807\u9898') || titleA.includes('\u5e74\u5ea6\u62a5\u544a');
      const isTitleB = titleB.includes('\u6807\u9898') || titleB.includes('\u5e74\u5ea6\u62a5\u544a');
      if (isTitleA && !isTitleB) return -1;
      if (!isTitleA && isTitleB) return 1;

      const numerals = [
        '\u4e00',
        '\u4e8c',
        '\u4e09',
        '\u56db',
        '\u4e94',
        '\u516d',
        '\u4e03',
        '\u516b',
        '\u4e5d',
        '\u5341',
      ];
      const idxA = numerals.findIndex((n) => titleA.includes(n));
      const idxB = numerals.findIndex((n) => titleB.includes(n));
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });

    const handleEditClick = () => {
      setEditingData({ data: parsed, highlightPaths: [] });
    };

    return (
      <div className="structured-content">
        <div className="report-content-toolbar">
          <h3>报告正文</h3>
          <div className="report-actions">
            <button className="btn-edit" onClick={handleEditClick}>
              编辑全部
            </button>
            <button className="secondary-btn" onClick={() => setShowParsed((prev) => !prev)}>
              {showParsed ? '折叠内容' : '展开内容'}
            </button>
          </div>
        </div>

        {isFocusMode && (
          <div className="focus-banner">
            <div className="focus-banner-main">
              <div className="focus-title">定位：{focusedCheck?.title}</div>
              <div className="focus-actions">
                <span className="focus-legend">
                  蓝色=左值，橙色=右值，角标显示左/右
                </span>
                <button className="btn-clear-focus" onClick={clearFocus}>
                  清除定位
                </button>
              </div>
            </div>
            {focusedCheck?.evidenceModel ? (
              <div className={`focus-evidence focus-evidence--${focusedCheck.evidenceModel.severity}`}>
                <div className="focus-evidence-summary">
                  <strong>证据说明</strong>
                  <span>{EVIDENCE_SEVERITY_LABELS[focusedCheck.evidenceModel.severity] || '来源说明'}</span>
                  <p>{focusedCheck.evidenceModel.summary}</p>
                </div>
                <div className="focus-evidence-grid">
                  <div>
                    <span>字段路径</span>
                    <code>{focusedCheck.evidenceModel.fieldPath}</code>
                  </div>
                  <div>
                    <span>原始值</span>
                    <strong>{focusedCheck.evidenceModel.originalValue}</strong>
                  </div>
                  <div>
                    <span>解析值</span>
                    <strong>{focusedCheck.evidenceModel.parsedValue}</strong>
                  </div>
                  <div>
                    <span>比对值</span>
                    <strong>{focusedCheck.evidenceModel.comparedValue}</strong>
                  </div>
                  <div>
                    <span>风险原因</span>
                    <strong>{focusedCheck.evidenceModel.reasonLabel}</strong>
                  </div>
                </div>
                {!focusedCheck.evidenceModel.hasDetailedSource ? (
                  <div className="focus-evidence-fallback">
                    {focusedCheck.evidenceModel.fallbackNotice || '暂无更详细来源，仅保留结构化字段路径'}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        {showParsed && (
          <>
            {suppressedTableCount > 0 && (
              <div className="missing-text-content empty-source-table-notice">
                {EMPTY_SOURCE_TABLE_NOTICE}
              </div>
            )}
            {sections.length === 0 && (
              <div className="missing-text-content empty-source-table-notice">
                {NO_VALID_CONTENT_NOTICE}
              </div>
            )}
            {sections.length > 0 && (
              <div className="sections-container">
            {sections.map((section, idx) => (
              <div key={idx} className="section-item">
                <h4 className="section-title">
                  {section.title}
                  {/* 显示第五/第六部分的质量问题标记 */}
                  {String(section?.title || '').includes('\u4e94') &&
                    qualityIssues.sec5 &&
                    qualityIssues.sec5.length > 0 && (
                      <span
                        className="quality-issue-badge"
                        title={qualityIssues.sec5.map((i) => i.title).join('\n')}
                      >
                        ⚠️ {qualityIssues.sec5.length}个问题
                      </span>
                    )}
                  {String(section?.title || '').includes('\u516d') &&
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
                  {String(section?.title || '').includes('\u4e94') &&
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
                  {String(section?.title || '').includes('\u516d') &&
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
                  {section.type === 'text' &&
                    typeof section.content === 'string' &&
                    section.content.trim() && (
                      <div className="text-content report-content-body">
                        {splitReportTextBlocks(
                          stripLeadingSectionTitle(section.content, section.title)
                        ).map((block, blockIndex) => {
                          const subsectionParts = getReportSubsectionParts(block);
                          const sectionIndex = section.__originalSectionIndex || idx + 1;
                          return (
                            <p
                              key={`${idx}-text-block-${blockIndex}`}
                              className={getReportTextBlockClass(block)}
                            >
                              {subsectionParts ? (
                                <>
                                  <span className="report-subsection-title">
                                    {highlightTextIssues(
                                      subsectionParts.heading,
                                      highlightTexts,
                                      sectionIndex
                                    )}
                                  </span>
                                  {highlightTextIssues(
                                    subsectionParts.rest,
                                    highlightTexts,
                                    sectionIndex
                                  )}
                                </>
                              ) : (
                                highlightTextIssues(block, highlightTexts, sectionIndex)
                              )}
                            </p>
                          );
                        })}
                      </div>
                    )}
                  {section.type === 'text' && (!section.content || !String(section.content).trim()) && (
                    <div className="missing-text-content">
                      该段正文未解析出来，请重新解析或检查源文件文本抽取结果。
                    </div>
                  )}
                  {section.type === 'table_2' && section.activeDisclosureData && (
                    <Table2View
                      data={section.activeDisclosureData}
                      highlightCells={activeHighlightCells}
                      ocrCorrections={visibleOcrCorrections}
                      tableIssues={table2Issues}
                    />
                  )}
                  {section.type === 'table_3' && section.tableData && (
                    <Table3View
                      data={section.tableData}
                      compact={true}
                      highlightCells={activeHighlightCells}
                      ocrCorrections={visibleOcrCorrections}
                      tableIssues={table3Issues}
                    />
                  )}
                  {section.type === 'table_4' && section.reviewLitigationData && (
                    <Table4View
                      data={section.reviewLitigationData}
                      highlightCells={activeHighlightCells}
                      ocrCorrections={visibleOcrCorrections}
                      tableIssues={table4Issues}
                    />
                  )}
                  {!['text', 'table_2', 'table_3', 'table_4'].includes(section.type) && (
                    <div className="unknown-type">
                      <p className="meta">未知类型：{section.type}</p>
                      <pre>{JSON.stringify(section, null, 2)}</pre>
                    </div>
                  )}
                </div>
              </div>
            ))}
              </div>
            )}
          </>
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
          <p className="value">{job.progress ?? '-'}%</p>
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

  const formatReviewStatusLabel = (reviewStatus) => {
    switch (reviewStatus) {
      case 'published':
        return '正式发布';
      case 'pending_review':
        return '待复核';
      case 'history':
        return '历史版本';
      default:
        return reviewStatus || '-';
    }
  };

  const renderVersionDetail = (title, version, emptyText) => (
    <section className="section">
      <h3>{title}</h3>
      {version ? (
        <div className="grid">
          <div>
            <p className="label">版本 ID</p>
            <p className="value">{version.version_id}</p>
          </div>
          <div>
            <p className="label">审核状态</p>
            <p className="value">{formatReviewStatusLabel(version.review_status)}</p>
          </div>
          <div>
            <p className="label">模型</p>
            <p className="value">{version.model || '-'}</p>
          </div>
          <div>
            <p className="label">Provider</p>
            <p className="value">{version.provider || '-'}</p>
          </div>
          <div>
            <p className="label">Prompt 版本</p>
            <p className="value">{version.prompt_version || '-'}</p>
          </div>
          <div>
            <p className="label">Schema 版本</p>
            <p className="value">{version.schema_version || '-'}</p>
          </div>
          <div>
            <p className="label">创建时间</p>
            <p className="value">{version.created_at || '-'}</p>
          </div>
          <div>
            <p className="label">发布时间</p>
            <p className="value">{version.approved_at || '-'}</p>
          </div>
          <div className="full-row">
            <p className="label">文件路径</p>
            <p className="value">{version.storage_path || '-'}</p>
          </div>
          <div className="full-row">
            <p className="label">文本路径</p>
            <p className="value">{version.text_path || '-'}</p>
          </div>
          <div className="full-row">
            <p className="label">文件哈希</p>
            <p className="value">{version.file_hash || '-'}</p>
          </div>
        </div>
      ) : (
        <p className="meta">{emptyText}</p>
      )}
    </section>
  );

  const formatParseStatusLabel = (status) => {
    switch (status) {
      case 'accepted':
        return '已接受';
      case 'superseded':
        return '已替换';
      case 'gate_failed':
        return '门禁失败';
      case 'failed':
        return '解析失败';
      case 'finalize_failed':
        return '提交失败';
      case 'running':
        return '运行中';
      case 'created':
        return '已创建';
      default:
        return status || '-';
    }
  };

  const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  };

  const renderParseHistoryPanel = () => (
    <section className="section">
      <div
        className="version-history-header parse-history-toggle"
        onClick={async () => {
          const nextShow = !showParseHistory;
          setShowParseHistory(nextShow);
          if (nextShow) {
            await loadParseHistory(reportId, workingVersionId);
          }
        }}
      >
        <span>{showParseHistory ? '▼' : '▶'}</span>
        <h3>解析历史 {parseHistory ? `(${parseHistory.length})` : ''}</h3>
      </div>

      {showParseHistory && (
        <div className="parse-history-content">
          {parseHistoryError && <div className="alert error">{parseHistoryError}</div>}
          {parseHistoryLoading ? (
            <p>加载中...</p>
          ) : parseHistory && parseHistory.length > 0 ? (
            <div className="parse-history-list">
              {parseHistory.map((run) => {
                const isBusy = Boolean(parseActionId && parseActionId.endsWith(`:${run.id}`));
                return (
                  <div
                    key={run.id}
                    className={`parse-run-card status-${run.status || 'unknown'} ${run.is_current ? 'is-current' : ''}`}
                  >
                    <div className="parse-run-head">
                      <div>
                        <strong>#{run.id} {run.is_current ? '当前' : ''}</strong>
                        <span className="parse-run-status">{formatParseStatusLabel(run.status)}</span>
                      </div>
                      <span className="meta">{formatDateTime(run.created_at)}</span>
                    </div>
                    <div className="parse-run-grid">
                      <span>version #{run.report_version_id}</span>
                      <span>{run.provider || '-'} / {run.model || '-'}</span>
                      <span>prompt {run.prompt_version || '-'}</span>
                      <span>attempt {run.attempt || 1}</span>
                      <span>source gate {run.source_gate_status || '-'}</span>
                      <span>
                        U/W/B {Number(run.source_gate_uncertain_count || 0)}/
                        {Number(run.source_gate_warning_count || 0)}/
                        {Number(run.source_gate_blocker_count || 0)}
                      </span>
                    </div>
                    {run.error_message && <p className="parse-run-error">{run.error_message}</p>}
                    <div className="parse-run-actions">
                      {run.status === 'accepted' && !run.is_current && (
                        <button
                          type="button"
                          className="secondary-btn"
                          disabled={isBusy}
                          onClick={() => handleParseAction(run, 'switch')}
                        >
                          设为当前
                        </button>
                      )}
                      {run.status === 'superseded' && (
                        <button
                          type="button"
                          className="secondary-btn"
                          disabled={isBusy}
                          onClick={() => handleParseAction(run, 'restore')}
                        >
                          恢复为当前
                        </button>
                      )}
                      {run.status === 'finalize_failed' && (
                        <button
                          type="button"
                          className="secondary-btn"
                          disabled={isBusy}
                          onClick={() => handleParseAction(run, 'retry')}
                        >
                          重试提交
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="meta">暂无解析历史</p>
          )}
        </div>
      )}
    </section>
  );

  const formatTraceValue = (value) => {
    if (value === null || value === undefined || value === '') return '-';
    return String(value);
  };

  const renderTraceSnapshot = (snapshot, emptyText = '暂无该层数据') => {
    if (!snapshot) {
      return <p className="meta">{emptyText}</p>;
    }

    return (
      <div className="trace-snapshot">
        <div className="trace-value-grid">
          {snapshot.items.map((item) => (
            <div
              key={`${item.key}-${item.label}`}
              className={`trace-value-card ${item.key === 'total' ? 'is-total' : ''}`}
            >
              <span className="trace-value-label">{item.label}</span>
              <strong className="trace-value-number">{formatTraceValue(item.value)}</strong>
            </div>
          ))}
        </div>
        <p className="trace-summary-line">
          分项合计：{formatTraceValue(snapshot.subtotal)}，总计：{formatTraceValue(snapshot.total)}
        </p>
      </div>
    );
  };

  const renderTraceRowCells = (cells = []) => {
    if (!Array.isArray(cells) || cells.length === 0) {
      return <p className="meta">当前行暂无 cells 入库证据。</p>;
    }

    return (
      <div className="trace-table-wrap">
        <table className="trace-table">
          <thead>
            <tr>
              <th>列</th>
              <th>原值</th>
              <th>标准值</th>
              <th>语义</th>
              <th>页码</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((cell) => (
              <tr key={cell.id || cell.cell_ref}>
                <td>{cell.col_key}</td>
                <td>{formatTraceValue(cell.value_raw)}</td>
                <td>{formatTraceValue(cell.normalized_value ?? cell.value_num)}</td>
                <td>{formatTraceValue(cell.value_semantic)}</td>
                <td>{formatTraceValue(cell.page_number)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderTracePanel = () => {
    if (!technicalModeEnabled) return null;

    return (
    <div className="trace-panel report-debug-panel">
      <div className="trace-panel-header">
        <div>
          <h3>问题溯源面板</h3>
          <p className="meta">
            只读排查，不改原值。用于判断表三疑似拆格问题出现在 source_text、parsed_json、
            facts/cells 还是前台展示层。
          </p>
        </div>
        <div className="trace-panel-actions">
          <button className="secondary-btn" onClick={() => setShowTracePanel((prev) => !prev)}>
            {showTracePanel ? '隐藏溯源面板' : '显示溯源面板'}
          </button>
          {showTracePanel && (
            <button
              className="secondary-btn"
              onClick={() => loadTraceData(reportId, workingVersionId)}
              disabled={traceLoading || !workingVersionId}
            >
              刷新证据
            </button>
          )}
        </div>
      </div>

      {showTracePanel && (
        <div className="trace-panel-body">
          <div className="trace-meta-grid">
            <div className="trace-meta-card">
              <span className="trace-meta-label">当前版本</span>
              <strong>{formatTraceValue(workingVersionId)}</strong>
            </div>
            <div className="trace-meta-card">
              <span className="trace-meta-label">前台表格来源</span>
              <strong>
                {traceView?.displaySourceLabel ||
                  (usingFactsSource ? 'facts.application' : 'parsed_json')}
              </strong>
            </div>
            <div className="trace-meta-card">
              <span className="trace-meta-label">source_text 来源</span>
              <strong>{formatTraceValue(traceData?.sourceMeta?.source_type)}</strong>
            </div>
            <div className="trace-meta-card">
              <span className="trace-meta-label">疑似拆格行数</span>
              <strong>{traceView?.suspiciousRows?.length ?? 0}</strong>
            </div>
          </div>

          <div className="trace-file-card">
            <div>
              <p className="label">原始文件</p>
              <p className="value">{workingVersion?.file_name || '-'}</p>
            </div>
            <div className="trace-file-paths">
              <p className="meta">storage_path：{workingVersion?.storage_path || '-'}</p>
              <p className="meta">text_path：{workingVersion?.text_path || '-'}</p>
            </div>
          </div>

          {traceLoading && <p className="meta">正在拉取 source_text 与 cells 证据...</p>}
          {traceError && <div className="alert error">{traceError}</div>}

          {!traceLoading && traceView && (
            <>
              <div className="trace-caveat">{traceView.caveat}</div>

              {!traceView.hasTable3 && (
                <p className="meta">当前版本没有可用于溯源的表三数据。</p>
              )}

              {traceView.hasTable3 && traceView.suspiciousRows.length === 0 && (
                <p className="meta">
                  当前展示结果里暂未检测到“相邻小数字拆格后又能与总计对齐”的疑似模式。
                </p>
              )}

              <div className="trace-row-list">
                {traceView.suspiciousRows.map((row) => (
                  <div key={row.fieldPath} className="trace-row-card">
                    <div className="trace-row-head">
                      <div>
                        <h4>{row.rowLabel}</h4>
                        <p className="meta">{row.summary}</p>
                      </div>
                      <div className="trace-row-metrics">
                        <span>分项合计 {formatTraceValue(row.sum)}</span>
                        <span>总计 {formatTraceValue(row.total)}</span>
                        <span>差值 {formatTraceValue(row.delta)}</span>
                      </div>
                    </div>

                    <div className="trace-badge-row">
                      {row.assessment.signals.map((signal, index) => (
                        <span
                          key={`${row.fieldPath}-signal-${index}`}
                          className={`trace-badge tone-${signal.tone}`}
                        >
                          {signal.text}
                        </span>
                      ))}
                    </div>

                    <div className="trace-conclusion">{row.assessment.conclusion}</div>

                    {row.candidates.length > 0 && (
                      <div className="trace-candidate-box">
                        <p className="label">疑似拆格候选</p>
                        <div className="trace-candidate-list">
                          {row.candidates.map((candidate, index) => (
                            <span
                              key={`${row.fieldPath}-candidate-${index}`}
                              className="trace-candidate-chip"
                            >
                              {candidate.leftLabel}={formatTraceValue(candidate.leftValue)} +{' '}
                              {candidate.rightLabel}={formatTraceValue(candidate.rightValue)} {'-> '}
                              {formatTraceValue(candidate.mergedValue)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="trace-layer-grid">
                      <div className="trace-layer-card">
                        <h5>前台当前展示</h5>
                        {renderTraceSnapshot(row.displaySnapshot, '当前展示层暂无该行数据')}
                      </div>
                      <div className="trace-layer-card">
                        <h5>parsed_json</h5>
                        {renderTraceSnapshot(row.parsedSnapshot, 'parsed_json 中暂无该行数据')}
                      </div>
                      <div className="trace-layer-card">
                        <h5>facts.application</h5>
                        {renderTraceSnapshot(row.factsSnapshot, 'facts.application 中暂无该行数据')}
                      </div>
                    </div>

                    <div className="trace-layer-card">
                      <h5>cells 入库证据</h5>
                      {renderTraceRowCells(row.rowCells)}
                    </div>

                    <div className="trace-layer-card">
                      <h5>source_text 片段</h5>
                      {row.sourceExcerpt ? (
                        <pre className="trace-pre">{row.sourceExcerpt}</pre>
                      ) : (
                        <p className="meta">当前未命中 source_text 片段。</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
    );
  };

  const getPublishErrorMessage = (err) => {
    const code = err?.response?.data?.error;
    const openIssueCount = err?.response?.data?.open_issue_count;

    if (code === 'checks_not_run') {
      return '发布失败：请先对当前版本运行勾稽关系校验。';
    }
    if (code === 'open_review_issues') {
      return `发布失败：仍有 ${openIssueCount ?? 0} 个待处理问题，请先复核或修正。`;
    }
    if (code === 'materialized_facts_missing') {
      return '发布失败：当前版本尚未成功入库 facts，请先完成解析/物化。';
    }
    return `发布失败：${code || err?.message || '未知错误'}`;
  };

  const handlePublishVersion = async (version) => {
    if (!version?.id || !reportId) return;

    const isPendingVersion = version.review_status === 'pending_review';
    const confirmMessage = isPendingVersion
      ? `确认将待复核版本 #${version.id} 审核通过并正式发布吗？`
      : `确认将版本 #${version.id} 发布为正式版本吗？`;

    const shouldPublish = await confirmAction({
      title: isPendingVersion ? '审核并发布版本' : '发布版本',
      message: confirmMessage,
      confirmText: '发布',
      cancelText: '取消',
      tone: 'warning',
    });
    if (!shouldPublish) {
      return;
    }

    try {
      await apiClient.post(`/reports/${reportId}/versions/${version.id}/publish`);
      toast.success('版本已发布', `版本 #${version.id} 已正式发布。`);
      await refresh();
    } catch (err) {
      toast.error('发布失败', getPublishErrorMessage(err));
    }
  };

  const handleFlowAction = async (action) => {
    if (!action) return;
    if (action.href) {
      window.location.href = action.href;
      return;
    }
    if (action.target === 'checks') {
      setActiveTab('checks');
      return;
    }
    if (action.target === 'parse') {
      await handleReparse();
      return;
    }
    if (action.target === 'versions') {
      if (pendingVersion) {
        setActiveTab('checks');
        return;
      }
      if (activeVersion) {
        await handlePublishVersion({
          id: activeVersion.version_id,
          review_status: activeVersion.review_status,
        });
        return;
      }
      setShowVersionHistory(true);
      await loadVersionHistory(reportId);
    }
  };

  return (
    <div className="report-detail">
      <div className="card">
        <PageHeader
          title="报告详情"
          subtitle="查看政府信息公开年度报告正文、数据表格与复核状态"
          actions={(
            <>
              {technicalModeEnabled && (
                <Button
                  className="report-technical-toggle"
                  onClick={() => setShowMetadata(!showMetadata)}
                >
                  {showMetadata ? '隐藏技术信息' : '显示技术信息'}
                </Button>
              )}
              {canMaintainReports && (
                <>
                  <Button onClick={refresh} disabled={loading}>刷新</Button>
                  <Button onClick={handleReparse} disabled={loading}>自动解析</Button>
                  <Button
                    variant="danger"
                    className="report-danger-action"
                    onClick={handleDelete}
                    disabled={loading}
                  >
                    删除报告
                  </Button>
                </>
              )}
              <Button onClick={handleBack}>返回上一层</Button>
            </>
          )}
        />
        {false && (
        <div className="detail-header report-detail__legacy-header">
          <div>
            <h2>报告详情</h2>
            <p className="subtitle">查看政府信息公开年度报告正文与数据表格</p>
          </div>
          <div className="actions">
            {technicalModeEnabled && (
              <button
                className="action-btn report-technical-toggle"
                onClick={() => setShowMetadata(!showMetadata)}
              >
                {showMetadata ? '隐藏技术信息' : '显示技术信息'}
              </button>
            )}
            {canMaintainReports && (
              <div className="report-admin-actions">
                <button className="action-btn" onClick={refresh} disabled={loading}>
                  刷新
                </button>
                <button className="action-btn" onClick={handleReparse} disabled={loading}>
                  自动解析
                </button>
                <button
                  className="action-btn danger report-danger-action"
                  onClick={handleDelete}
                  disabled={loading}
                >
                  删除报告
                </button>
              </div>
            )}
            <button className="action-btn" onClick={handleBack}>
              返回上一层
            </button>
          </div>
        </div>

        )}
        {loading && <p>加载中...</p>}

        {error && <div className="alert error">{error}</div>}

        {!loading && !error && report && (
          <>
            <ReportFlowStatusBar report={report} onAction={handleFlowAction} />

            {/* 技术诊断信息仅在显式 debug 模式下允许展开，普通报告视图不渲染。 */}
            {technicalModeEnabled && showMetadata && (
              <div className="report-technical-info">
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

                {renderVersionDetail('正式发布版本', activeVersion, '暂无正式发布版本')}
                {renderVersionDetail('待复核版本', pendingVersion, '当前没有待复核版本')}

                {/* 折叠式版本历史 */}
                {renderParseHistoryPanel()}

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
                      if (newShow) {
                        await loadVersionHistory(reportId);
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
                              <div
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  gap: '12px',
                                  marginTop: '6px',
                                  fontSize: '12px',
                                  color: '#888',
                                }}
                              >
                                <span>状态：{formatReviewStatusLabel(v.review_status)}</span>
                                <span>问题项：{Number(v.open_issue_count || 0)}</span>
                                {v.approved_at && (
                                  <span>发布时间：{new Date(v.approved_at).toLocaleString()}</span>
                                )}
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
                                    await handlePublishVersion(v);
                                  }}
                                >
                                  {v.review_status === 'pending_review' ? '审核通过并发布' : '发布此版本'}
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
              </div>
            )}

            {/* Tab 切换 */}
            <div className="tabs-container">
              <div className="tabs">
                <button
                  className={`tab ${activeTab === 'content' ? 'active' : ''}`}
                  onClick={() => setActiveTab('content')}
                >
                  年报内容
                </button>
                <button
                  className={`tab ${activeTab === 'checks' ? 'active' : ''}`}
                  onClick={() => setActiveTab('checks')}
                >
                  勾稽关系校验
                </button>
                <button
                  className={`tab ${activeTab === 'quality' ? 'active' : ''}`}
                  onClick={() => setActiveTab('quality')}
                >
                  数据质量审计
                </button>
                <button
                  className={`tab ${activeTab === 'visionReview' ? 'active' : ''}`}
                  onClick={() => setActiveTab('visionReview')}
                >
                  视觉复核
                </button>
              </div>
            </div>

            {/* Tab 内容 */}
            {activeTab === 'content' && (
              <section className="section report-content-section">
                <div className="report-title-banner">
                  <h2>
                    {report?.year || ''}年{report?.region_name || report?.region?.name || ''}
                    政府信息公开年报
                  </h2>
                </div>
                {technicalModeEnabled && hasPendingReview && (
                  <p className="meta">
                    当前页面默认展示待复核版本 #{pendingVersion?.version_id}
                    {activeVersion ? `；正式发布版本为 #${activeVersion.version_id}` : '；当前尚无正式发布版本'}。
                  </p>
                )}
                {technicalModeEnabled && factsLoadError && (
                  <div className="alert error">{factsLoadError}</div>
                )}
                {technicalModeEnabled && !usingFactsSource && !factsLoadError && (
                  <p className="meta">facts 数据尚未就绪，暂不展示表格。</p>
                )}
                {pendingOcrCorrections.length > 0 && (
                  <div className="ocr-correction-banner">
                    <strong>OCR / 视觉复核待确认</strong>
                    <span>共 {pendingOcrCorrections.length} 个单元格存在待确认修正，当前仅作源表复核提示，不计入勾稽问题或数据质量风险。</span>
                    <button className="secondary-btn" onClick={() => setActiveTab('visionReview')}>
                      去复核页
                    </button>
                  </div>
                )}
                {pendingOcrCorrections.length === 0 && confirmedOcrCorrections.length > 0 && (
                  <div className="ocr-correction-banner ocr-correction-banner--confirmed">
                    <strong>已确认修正</strong>
                    <span>已采用 {confirmedOcrCorrections.length} 个 OCR 修正值。该成功态仅用于源表复核说明，不改变勾稽高亮和编号。</span>
                  </div>
                )}
                {pendingOcrCorrections.length === 0 && sourceTableAnomalyReviews.length > 0 && (
                  <div className="ocr-correction-banner ocr-correction-banner--source">
                    <strong>源表复核提示</strong>
                    <span>
                      OCR 与当前解析一致，但相关勾稽仍失败，更像是源表原始结构或填报异常。该提示不计入勾稽问题数，也不计入数据质量风险数。
                    </span>
                  </div>
                )}
                {pendingOcrCorrections.length === 0 &&
                  confirmedOcrCorrections.length === 0 &&
                  sourceTableAnomalyReviews.length === 0 &&
                  inconclusiveVisionReviews.length > 0 && (
                    <div className="ocr-correction-banner ocr-correction-banner--review">
                      <strong>待人工复核</strong>
                      <span>当前存在 OCR / 视觉复核不可判定项，建议在复核页查看源表截图、不可读单元格和复核状态说明。</span>
                      <button className="secondary-btn" onClick={() => setActiveTab('visionReview')}>
                        去复核页
                      </button>
                    </div>
                  )}
                {renderTracePanel()}
                {renderParsedContent(displayParsedJson)}
              </section>
            )}

            {activeTab === 'checks' && (
              <section className="section">
                {/* <h3>一致性校验</h3> Use header inside component */}
                <ConsistencyCheckView
                  reportId={reportId}
                  versionId={workingVersionId}
                  filterGroups={['table2', 'table3', 'table4', 'text']}
                  onLocate={handleLocateIssue}
                  onChecksUpdated={() => fetchHighlights(workingVersionId)}
                  onEdit={(paths) => {
                    if (!displayParsedJson) return;
                    const editData = {
                      data: displayParsedJson,
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
                  versionId={workingVersionId}
                  filterGroups={['visual', 'structure', 'quality']}
                  onLocate={handleLocateIssue}
                  onChecksUpdated={() => fetchHighlights(workingVersionId)}
                  onEdit={(paths) => {
                    if (!displayParsedJson) return;
                    const editData = {
                      data: displayParsedJson,
                      highlightPaths: paths || [],
                    };
                    setEditingData(editData);
                  }}
                />
              </section>
            )}

            {activeTab === 'visionReview' && (
              <section className="section">
                <VisionReviewPanel
                  reportId={reportId}
                  versionId={workingVersionId}
                  onDataChange={({ reviews = [], corrections = [] }) => {
                    setVisionReviews(reviews);
                    setOcrCorrections(corrections);
                  }}
                  onCorrectionsResolved={async ({ action } = {}) => {
                    if (action === 'confirm') {
                      await refresh();
                    } else {
                      await fetchHighlights(workingVersionId);
                    }
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
              versionId={workingVersionId}
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
