import {
  QUALITY_AUDIT_GROUP_KEYS,
  getConsistencyGroupKey,
  sortConsistencyItems,
} from './consistencyDisplay';
import {
  normalizeIssueGroups,
  resolveIssueId,
} from './issueViewModelAdapter';
import { normalizeDiagnosticsIssueGroups } from './diagnosticsIssueAdapter';
import { normalizeQualityIssueGroups } from './qualityIssueAdapter';
import { normalizeVisionReviewGroups } from './visionIssueAdapter';

const DEFAULT_OPTIONS = {
  domain: 'consistency',
  displayMode: 'management',
  includeUncertain: true,
  includeConfirmed: true,
  includeDismissed: true,
  displayNoScope: 'group',
  existingDisplayNoMap: null,
};

const safeArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

const getAutoStatus = (item) => String(item?.auto_status || item?.autoStatus || '').toUpperCase();

const getHumanStatus = (item) => String(item?.human_status || item?.humanStatus || 'pending');

const isQualityGroupKey = (groupKey) => QUALITY_AUDIT_GROUP_KEYS.includes(groupKey);

const resolveAggregationInput = (groupsOrConfig = [], maybeOptions = {}) => {
  if (Array.isArray(groupsOrConfig)) {
    return {
      groups: groupsOrConfig,
      options: {
        ...DEFAULT_OPTIONS,
        ...(maybeOptions || {}),
      },
    };
  }

  return {
    groups: Array.isArray(groupsOrConfig?.groups) ? groupsOrConfig.groups : [],
    options: {
      ...DEFAULT_OPTIONS,
      ...(groupsOrConfig || {}),
    },
  };
};

const includeGroupByDomain = (groupKey, domain) => {
  if (domain === 'quality') {
    return isQualityGroupKey(groupKey);
  }
  if (domain === 'consistency') {
    return !isQualityGroupKey(groupKey);
  }
  return true;
};

const resolveDisplayScopeKey = (groupKey, scope) => {
  switch (scope) {
    case 'global':
      return '__global__';
    case 'table':
      return groupKey || '__unknown__';
    case 'group':
    default:
      return groupKey || '__unknown__';
  }
};

const isRawFailItem = (item) => getAutoStatus(item) === 'FAIL';

const isActiveProblemItem = (item) =>
  getAutoStatus(item) === 'FAIL' && getHumanStatus(item) !== 'dismissed';

const isPendingReviewItem = (item) =>
  getHumanStatus(item) === 'pending' && getAutoStatus(item) !== 'NOT_ASSESSABLE';

const buildStatsFromIssues = (issues = []) => {
  const stats = {
    ruleCount: 0,
    rawFailCount: 0,
    problemCount: 0,
    pendingCount: 0,
    pendingCountRaw: 0,
    reviewCount: 0,
    confirmedCount: 0,
    dismissedCount: 0,
    notAssessableCount: 0,
  };

  issues.forEach((issue) => {
    const autoStatus = String(issue?.autoStatus || '').toUpperCase();
    const humanStatus = String(issue?.humanStatus || 'pending');

    if (autoStatus !== 'NOT_ASSESSABLE') {
      stats.ruleCount += 1;
    } else {
      stats.notAssessableCount += 1;
    }

    if (autoStatus === 'FAIL') {
      stats.rawFailCount += 1;
      if (humanStatus !== 'dismissed') {
        stats.problemCount += 1;
      }
    }

    if (humanStatus === 'pending' && autoStatus !== 'NOT_ASSESSABLE') {
      stats.pendingCount += 1;
      stats.pendingCountRaw += 1;
      stats.reviewCount += 1;
    }

    if (humanStatus === 'confirmed') {
      stats.confirmedCount += 1;
    }

    if (humanStatus === 'dismissed') {
      stats.dismissedCount += 1;
    }
  });

  return stats;
};

export const buildDisplayNoMapFromGroups = (groups = [], options = {}) => {
  const displayNoMap = { ...(options.existingDisplayNoMap || {}) };
  const counters = new Map();
  const scope = options.displayNoScope || 'group';

  (groups || []).forEach((group) => {
    const groupKey = getConsistencyGroupKey(group);
    const scopeKey = resolveDisplayScopeKey(groupKey, scope);
    const items = Array.isArray(group?.items) ? group.items : [];

    items.forEach((item) => {
      if (!isActiveProblemItem(item)) {
        return;
      }

      const issueId = resolveIssueId(item, groupKey);
      if (displayNoMap[issueId] !== undefined && displayNoMap[issueId] !== null) {
        return;
      }

      const nextValue = (counters.get(scopeKey) || 0) + 1;
      counters.set(scopeKey, nextValue);
      displayNoMap[issueId] = nextValue;
    });
  });

  return displayNoMap;
};

export const buildLocatePayloadMapFromIssues = (issues = []) =>
  issues.reduce((acc, issue) => {
    const evidence = issue?.evidence || {};
    const fallbackPaths = safeArray(evidence?.paths);
    if (fallbackPaths.length === 0 && evidence?.values?.fieldPath) {
      fallbackPaths.push(evidence.values.fieldPath);
    }

    acc[issue.issueId] = {
      item: issue.rawItem,
      title: issue.title,
      leftPaths: safeArray(evidence?.leftPaths),
      rightPaths: safeArray(evidence?.rightPaths),
      fallbackPaths,
    };
    return acc;
  }, {});

export const collectPendingItemIdsFromIssues = (issues = []) =>
  sortConsistencyItems(
    issues.map((issue) => ({
      ...(issue?.rawItem || {}),
      displayNo: issue?.displayNo,
    }))
  )
    .filter((item) => item?.human_status === 'pending' && item?.auto_status !== 'NOT_ASSESSABLE' && item?.id)
    .map((item) => item.id)
    .filter((id) => id !== null && id !== undefined);

export const buildGroupSummariesFromIssues = (issuesByGroupKey = {}) =>
  Object.entries(issuesByGroupKey).reduce((acc, [groupKey, issues]) => {
    acc[groupKey] = buildStatsFromIssues(issues);
    return acc;
  }, {});

export const buildSummaryFromGroupSummaries = (groupSummaries = {}) =>
  Object.values(groupSummaries).reduce(
    (acc, stats) => ({
      ruleCount: acc.ruleCount + (stats?.ruleCount || 0),
      rawFailCount: acc.rawFailCount + (stats?.rawFailCount || 0),
      problemCount: acc.problemCount + (stats?.problemCount || 0),
      pendingCount: acc.pendingCount + (stats?.pendingCount || 0),
      pendingCountRaw: acc.pendingCountRaw + (stats?.pendingCountRaw || 0),
      reviewCount: acc.reviewCount + (stats?.reviewCount || 0),
      confirmedCount: acc.confirmedCount + (stats?.confirmedCount || 0),
      dismissedCount: acc.dismissedCount + (stats?.dismissedCount || 0),
      notAssessableCount: acc.notAssessableCount + (stats?.notAssessableCount || 0),
    }),
    {
      ruleCount: 0,
      rawFailCount: 0,
      problemCount: 0,
      pendingCount: 0,
      pendingCountRaw: 0,
      reviewCount: 0,
      confirmedCount: 0,
      dismissedCount: 0,
      notAssessableCount: 0,
    }
  );

export const aggregateIssuesFromChecks = (groupsOrConfig = [], maybeOptions = {}) => {
  const { groups, options } = resolveAggregationInput(groupsOrConfig, maybeOptions);
  const filteredGroups = (groups || []).filter((group) =>
    includeGroupByDomain(getConsistencyGroupKey(group), options.domain)
  );

  const displayNoMap = buildDisplayNoMapFromGroups(filteredGroups, options);
  const normalized = normalizeIssueGroups(filteredGroups, {
    displayNoMap,
  });

  const issues = normalized.issues;
  const activeIssues = issues.filter((issue) => issue?.autoStatus === 'FAIL' && issue?.humanStatus !== 'dismissed');
  const reviewIssues = issues.filter(
    (issue) => issue?.humanStatus === 'pending' && issue?.autoStatus !== 'NOT_ASSESSABLE'
  );
  const dismissedIssues = issues.filter((issue) => issue?.humanStatus === 'dismissed');
  const confirmedIssues = issues.filter((issue) => issue?.humanStatus === 'confirmed');
  const issuesByGroupKey = normalized.issuesByGroupKey;
  const issuesByTableId = issues.reduce((acc, issue) => {
    const tableId = issue?.tableId || '__none__';
    if (!acc[tableId]) {
      acc[tableId] = [];
    }
    acc[tableId].push(issue);
    return acc;
  }, {});
  const issueMapById = issues.reduce((acc, issue) => {
    acc[issue.issueId] = issue;
    return acc;
  }, {});
  const groupSummaries = buildGroupSummariesFromIssues(issuesByGroupKey);
  const summary = buildSummaryFromGroupSummaries(groupSummaries);
  const locatePayloadMap = buildLocatePayloadMapFromIssues(issues);
  const pendingItemIds = collectPendingItemIdsFromIssues(issues);

  return {
    issues,
    activeIssues,
    reviewIssues,
    dismissedIssues,
    confirmedIssues,
    issuesByGroupKey,
    issuesByTableId,
    issueMapById,
    markerIndexByPath: normalized.markerIndexByPath,
    displayNoMap,
    summary,
    groupSummaries,
    locatePayloadMap,
    pendingItemIds,
  };
};

export const aggregateQualityIssuesFromChecks = (groupsOrConfig = [], maybeOptions = {}) => {
  const { groups, options } = resolveAggregationInput(groupsOrConfig, maybeOptions);
  const filteredGroups = (groups || []).filter((group) =>
    includeGroupByDomain(getConsistencyGroupKey(group), 'quality')
  );

  const normalized = normalizeQualityIssueGroups(filteredGroups, options);
  const issues = normalized.issues;
  const issuesByGroupKey = normalized.issuesByGroupKey;
  const issuesByTableId = issues.reduce((acc, issue) => {
    const tableId = issue?.tableId || '__none__';
    if (!acc[tableId]) {
      acc[tableId] = [];
    }
    acc[tableId].push(issue);
    return acc;
  }, {});
  const issueMapById = issues.reduce((acc, issue) => {
    acc[issue.issueId] = issue;
    return acc;
  }, {});
  const groupSummaries = Object.entries(issuesByGroupKey).reduce((acc, [groupKey, groupIssues]) => {
    acc[groupKey] = {
      itemCount: groupIssues.length,
      riskCount: groupIssues.filter((issue) => {
        const autoStatus = String(issue?.autoStatus || issue?.auto_status || '').toUpperCase();
        const humanStatus = String(issue?.humanStatus || issue?.human_status || 'pending').toLowerCase();
        return (autoStatus === 'FAIL' || autoStatus === 'UNCERTAIN') && humanStatus !== 'dismissed';
      }).length,
      reviewCount: groupIssues.filter((issue) => {
        const autoStatus = String(issue?.autoStatus || issue?.auto_status || '').toUpperCase();
        const humanStatus = String(issue?.humanStatus || issue?.human_status || 'pending').toLowerCase();
        return humanStatus === 'pending' && autoStatus !== 'NOT_ASSESSABLE';
      }).length,
      resolvedCount: groupIssues.filter((issue) => String(issue?.humanStatus || issue?.human_status || '').toLowerCase() === 'confirmed').length,
      dismissedCount: groupIssues.filter((issue) => String(issue?.humanStatus || issue?.human_status || '').toLowerCase() === 'dismissed').length,
      notAssessableCount: groupIssues.filter((issue) => String(issue?.autoStatus || issue?.auto_status || '').toUpperCase() === 'NOT_ASSESSABLE').length,
    };
    return acc;
  }, {});
  const summary = Object.values(groupSummaries).reduce(
    (acc, stats) => ({
      itemCount: acc.itemCount + (stats?.itemCount || 0),
      riskCount: acc.riskCount + (stats?.riskCount || 0),
      reviewCount: acc.reviewCount + (stats?.reviewCount || 0),
      resolvedCount: acc.resolvedCount + (stats?.resolvedCount || 0),
      dismissedCount: acc.dismissedCount + (stats?.dismissedCount || 0),
      notAssessableCount: acc.notAssessableCount + (stats?.notAssessableCount || 0),
    }),
    {
      itemCount: 0,
      riskCount: 0,
      reviewCount: 0,
      resolvedCount: 0,
      dismissedCount: 0,
      notAssessableCount: 0,
    }
  );
  const locatePayloadMap = buildLocatePayloadMapFromIssues(issues);

  return {
    issues,
    issuesByGroupKey,
    issuesByTableId,
    issueMapById,
    markerIndexByPath: normalized.markerIndexByPath,
    summary,
    groupSummaries,
    locatePayloadMap,
  };
};

const sortExternalIssues = (issues = []) =>
  [...issues].sort((left, right) => {
    const leftPriority = Number(left?.priority || 0);
    const rightPriority = Number(right?.priority || 0);
    if (leftPriority !== rightPriority) return rightPriority - leftPriority;

    const leftSource = String(left?.source || '');
    const rightSource = String(right?.source || '');
    if (leftSource !== rightSource) return leftSource.localeCompare(rightSource, 'zh-CN');

    const leftIssueId = String(left?.issueId || '');
    const rightIssueId = String(right?.issueId || '');
    return leftIssueId.localeCompare(rightIssueId, 'zh-CN');
  });

export const aggregateExternalIssueSources = ({
  qualityIssues = [],
  visionReviews = [],
  ocrCorrections = [],
  diagnostics = null,
} = {}) => {
  const qualityNormalized = normalizeQualityIssueGroups(qualityIssues);
  const visionNormalized = normalizeVisionReviewGroups({
    reviews: visionReviews,
    corrections: ocrCorrections,
  });
  const diagnosticsNormalized = normalizeDiagnosticsIssueGroups(diagnostics);

  const issuesByDomain = {
    quality: qualityNormalized.issues,
    vision: visionNormalized.issues.filter((issue) => issue?.source === 'vision'),
    ocr: visionNormalized.issues.filter((issue) => issue?.source === 'ocr'),
    diagnostics: diagnosticsNormalized.issues,
  };

  const issues = sortExternalIssues([
    ...issuesByDomain.quality,
    ...issuesByDomain.vision,
    ...issuesByDomain.ocr,
    ...issuesByDomain.diagnostics,
  ]);

  const markerIndexByPath = {};
  const markerPriorityIndex = {};
  const sourceSummaries = Object.fromEntries(
    Object.entries(issuesByDomain).map(([domain, domainIssues]) => [
      domain,
      {
        issueCount: domainIssues.length,
        markerCount: domainIssues.reduce((acc, issue) => acc + (issue?.markers?.length || 0), 0),
      },
    ])
  );

  issues.forEach((issue) => {
    (issue?.markers || []).forEach((marker) => {
      if (!marker?.path) return;
      if (!markerIndexByPath[marker.path]) {
        markerIndexByPath[marker.path] = [];
      }
      markerIndexByPath[marker.path].push(issue);

      if (!markerPriorityIndex[marker.path]) {
        markerPriorityIndex[marker.path] = [];
      }
      markerPriorityIndex[marker.path].push(marker);
    });
  });

  Object.keys(markerIndexByPath).forEach((path) => {
    markerIndexByPath[path] = sortExternalIssues(markerIndexByPath[path]);
  });

  Object.keys(markerPriorityIndex).forEach((path) => {
    markerPriorityIndex[path] = [...markerPriorityIndex[path]].sort((left, right) => {
      const leftPriority = Number(left?.priority || 0);
      const rightPriority = Number(right?.priority || 0);
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      return String(left?.issueId || '').localeCompare(String(right?.issueId || ''), 'zh-CN');
    });
  });

  return {
    issues,
    issuesByDomain,
    markerIndexByPath,
    markerPriorityIndex,
    sourceSummaries,
    qualityIssues: qualityNormalized.issues,
    visionIssues: visionNormalized.issues,
    diagnosticsIssues: diagnosticsNormalized.issues,
  };
};

export const __internal = {
  isRawFailItem,
  isActiveProblemItem,
  isPendingReviewItem,
};
