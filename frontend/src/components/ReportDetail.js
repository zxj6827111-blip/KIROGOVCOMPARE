import React, { useEffect, useState } from 'react';
import './ReportDetail.css';
import { apiClient } from '../apiClient';
import { Table2View, Table3View, Table4View } from './TableViews';
import { normalizeTablePath } from '../utils/tableRowColMapping';
import { buildTable3TraceModel } from '../utils/reportTrace';
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

const getErrorMessage = (err, fallback = '请求失败') =>
  err?.response?.data?.error || err?.message || fallback;

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

const toNumberValue = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
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
    setNested(data, [...applicantPath, ...responsePath], toNumberValue(row?.count, 0));
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
    data[caseType][resultType] = toNumberValue(row?.count, 0);
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

  const parsedTextSections = parsedSections.filter(
    (section) =>
      section?.type === 'text' &&
      typeof section?.content === 'string' &&
      section.content.trim().length > 0
  );

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

function ReportDetail({ reportId: propReportId, onBack }) {
  const reportId = propReportId || window.location.pathname.split('/').pop();
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
  const [highlightTexts, setHighlightTexts] = useState([]); // 勾稽问题文本
  const [focusedCheck, setFocusedCheck] = useState(null); // 当前定位的勾稽问题
  const [focusedCells, setFocusedCells] = useState([]); // 定位模式下的单元格路径
  const [qualityIssues, setQualityIssues] = useState({}); // 质量审计问题 { sec5: [...], sec6: [...] }
  const [showVersionHistory, setShowVersionHistory] = useState(false); // 版本历史折叠
  const [versionHistory, setVersionHistory] = useState(null); // 历史版本列表数据
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [showTracePanel, setShowTracePanel] = useState(false);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState('');
  const [traceData, setTraceData] = useState(null);
  const isTablePath = (p) =>
    p &&
    (p.includes('tableData') ||
      p.includes('reviewLitigationData') ||
      p.includes('activeDisclosureData'));

  const handleBack = () => {
    if (onBack) return onBack();
    window.history.back();
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
    if (showTracePanel && reportId && workingVersionId) {
      loadTraceData(reportId, workingVersionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTracePanel, reportId, workingVersionId]);

  const refresh = async () => {
    if (!reportId) return;
    await loadReportAndFacts(reportId, { errorPrefix: '刷新失败' });
    if (showVersionHistory) {
      await loadVersionHistory(reportId);
    }
    if (showTracePanel && workingVersionId) {
      await loadTraceData(reportId, workingVersionId);
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
    if (!window.confirm('确认重新触发解析吗？将创建新的 parse 任务。')) return;
    setError('');
    setLoading(true);
    try {
      const resp = await apiClient.post(
        `/reports/${reportId}/parse`,
        workingVersionId ? { version_id: workingVersionId } : {}
      );
      const jobId = resp.data?.job_id || resp.data?.jobId;
      if (!jobId) throw new Error('未返回有效 job_id');

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
  const mergedDisplay = buildDisplayParsedJson(factsPayload, workingVersion?.parsed_json);
  const displayParsedJson = mergedDisplay.parsed;
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
    const sections = [...parsed.sections];
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
        <div className="content-header">
          <div />
          <div>
            <button className="btn-edit" onClick={handleEditClick} style={{ marginRight: '10px' }}>
              编辑全部
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
              <span className="focus-legend">
                蓝色=左值，橙色=右值，角标显示左/右
              </span>
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
                      <p className="meta">未知类型：{section.type}</p>
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

  const renderTracePanel = () => (
    <div className="trace-panel">
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

    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      await apiClient.post(`/reports/${reportId}/versions/${version.id}/publish`);
      alert(`版本 #${version.id} 已正式发布`);
      await refresh();
    } catch (err) {
      alert(getPublishErrorMessage(err));
    }
  };

  return (
    <div className="report-detail">
      <div className="card">
        <div className="detail-header">
          <div>
            <h2>报告详情</h2>
            <p className="subtitle">查看报告、待复核版本与正式发布版本信息</p>
          </div>
          <div className="actions">
            <button className="action-btn" onClick={refresh} disabled={loading}>
              刷新
            </button>
            <button className="action-btn" onClick={handleReparse} disabled={loading}>
              自动解析
            </button>
            <button className="action-btn danger" onClick={handleDelete} disabled={loading}>
              删除报告
            </button>
            <button className="action-btn" onClick={handleBack}>
              返回上一层
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

                {renderVersionDetail('正式发布版本', activeVersion, '暂无正式发布版本')}
                {renderVersionDetail('待复核版本', pendingVersion, '当前没有待复核版本')}

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
              </>
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
              </div>
            </div>

            {/* Tab 内容 */}
            {activeTab === 'content' && (
              <section className="section">
                <div className="report-title-banner">
                  <h2>
                    {report?.year || ''}年{report?.region_name || report?.region?.name || ''}
                    政府信息公开年报
                  </h2>
                </div>
                {hasPendingReview && (
                  <p className="meta">
                    当前页面默认展示待复核版本 #{pendingVersion?.version_id}
                    {activeVersion ? `；正式发布版本为 #${activeVersion.version_id}` : '；当前尚无正式发布版本'}。
                  </p>
                )}
                {factsLoadError && <div className="alert error">{factsLoadError}</div>}
                {!usingFactsSource && !factsLoadError && (
                  <p className="meta">facts 数据尚未就绪，暂不展示表格。</p>
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
