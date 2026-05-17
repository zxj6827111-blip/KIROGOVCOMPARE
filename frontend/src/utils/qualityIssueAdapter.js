import { buildMarkerShell, sortMarkersByPriority } from './issueMarkerPriority';
import { getConsistencyItemGroupKey } from './consistencyDisplay';
import { normalizeIssueItem, resolveIssueId } from './issueViewModelAdapter';

const QUALITY_GROUP_KEYS = new Set(['visual', 'structure', 'quality']);

const safeArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

const getLowerText = (value) => String(value || '').toLowerCase();

const resolveQualityFieldPath = (item) => {
  const evidence = item?.evidence || item?.evidence_json || {};
  return (
    item?.fieldPath ||
    item?.field_path ||
    evidence?.values?.fieldPath ||
    safeArray(evidence?.paths)[0] ||
    item?.path ||
    null
  );
};

const resolveQualitySeverity = (autoStatus, humanStatus) => {
  const normalizedAutoStatus = String(autoStatus || '').toUpperCase();
  const normalizedHumanStatus = String(humanStatus || '').toLowerCase();

  if (normalizedHumanStatus === 'confirmed') return 'success';
  if (normalizedHumanStatus === 'dismissed') return 'neutral';
  if (normalizedAutoStatus === 'NOT_ASSESSABLE') return 'neutral';
  if (normalizedAutoStatus === 'PASS') return 'success';
  return 'warning';
};

export const classifyQualityIssueType = (item) => {
  const groupKey = String(getConsistencyItemGroupKey(item, '') || '').toLowerCase();
  const checkKey = getLowerText(item?.check_key || item?.checkKey);
  const title = getLowerText(item?.title);
  const expr = getLowerText(item?.expr || item?.formula);
  const merged = `${checkKey} ${title} ${expr}`;

  if (groupKey === 'structure') return 'quality_structure';
  if (checkKey.includes('structure') || checkKey.includes('split') || checkKey.includes('table_missing')) {
    return 'quality_structure';
  }
  if (checkKey.includes('narrative') || checkKey.includes('year_mismatch') || checkKey.includes('text_extraction') || checkKey.includes('conflict') || checkKey.includes('gap')) {
    return 'quality_text_extraction';
  }
  if (checkKey.includes('format') || checkKey.includes('numeric') || checkKey.includes('parse') || merged.includes('format') || merged.includes('numeric') || merged.includes('parse')) {
    return 'quality_format';
  }
  if (checkKey.includes('empty') || checkKey.includes('missing') || merged.includes('empty') || merged.includes('missing')) {
    return 'quality_empty';
  }
  return 'quality_other';
};

const buildQualityMarkers = (item, issueType, issueId) => {
  const fieldPath = resolveQualityFieldPath(item);
  const evidence = item?.evidence || item?.evidence_json || {};
  const paths = [...safeArray(evidence?.paths), ...safeArray(evidence?.leftPaths), ...safeArray(evidence?.rightPaths)];
  const markerPaths = (paths.length > 0 ? paths : fieldPath ? [fieldPath] : []).filter(Boolean);

  return sortMarkersByPriority(
    markerPaths.map((path, index) =>
      buildMarkerShell({
        path,
        role: index === 0 ? 'primary' : 'context',
        issueType,
        source: 'quality',
        tone: 'quality',
        displayNo: null,
        priority: 50,
        issueId,
        autoStatus: item?.auto_status || item?.autoStatus || '',
        humanStatus: item?.human_status || item?.humanStatus || 'pending',
      })
    )
  );
};

export const normalizeQualityIssueItem = (item, options = {}) => {
  const groupKey = getConsistencyItemGroupKey(item, options.groupKey || '');
  const issueType = options.issueType || item?.issueType || classifyQualityIssueType(item);
  const autoStatus = options.autoStatus ?? item?.auto_status ?? item?.autoStatus ?? 'UNCERTAIN';
  const humanStatus = options.humanStatus ?? item?.human_status ?? item?.humanStatus ?? 'pending';
  const fieldPath = options.fieldPath ?? resolveQualityFieldPath(item);
  const issueId = options.issueId || `quality:${groupKey || 'group'}:${resolveIssueId(item, groupKey)}`;
  const markers = options.markers || buildQualityMarkers(item, issueType, issueId);

  const normalized = normalizeIssueItem(
    {
      ...item,
      group_key: groupKey,
      issueType,
      auto_status: autoStatus,
      human_status: humanStatus,
      evidence: item?.evidence || item?.evidence_json || {},
      fieldPath,
    },
    {
      ...options,
      groupKey,
      source: 'quality',
      issueType,
      issueId,
      displayNo: null,
      fieldPath,
      markers,
      autoStatus,
      humanStatus,
      severity: options.severity || resolveQualitySeverity(autoStatus, humanStatus),
      tone: 'quality',
      tableId: 'quality',
      priority: options.priority || 50,
    }
  );

  return {
    ...normalized,
    source: 'quality',
    tone: 'quality',
    issueId,
    stableIssueId: issueId,
    displayNo: null,
    qualityDisplayNo: null,
    fieldPath,
    severity: options.severity || resolveQualitySeverity(autoStatus, humanStatus),
    markers,
  };
};

export const normalizeQualityIssueGroups = (groups = []) => {
  const issues = [];
  const issuesByGroupKey = {};
  const markerIndexByPath = {};

  (groups || [])
    .filter((group) => QUALITY_GROUP_KEYS.has(String(getConsistencyItemGroupKey(group, '') || '').toLowerCase()))
    .forEach((group) => {
      const groupKey = getConsistencyItemGroupKey(group, '');
      const items = Array.isArray(group?.items) ? group.items : [];
      const normalizedItems = items
        .filter((item) => String(item?.auto_status || item?.autoStatus || '').toUpperCase() !== 'PASS')
        .map((item) => normalizeQualityIssueItem(item, { groupKey }));

      issuesByGroupKey[groupKey] = normalizedItems;
      normalizedItems.forEach((issue) => {
        issues.push(issue);
        issue.markers.forEach((marker) => {
          if (!marker?.path) return;
          if (!markerIndexByPath[marker.path]) {
            markerIndexByPath[marker.path] = [];
          }
          markerIndexByPath[marker.path].push(issue);
        });
      });
    });

  Object.keys(markerIndexByPath).forEach((path) => {
    markerIndexByPath[path] = markerIndexByPath[path].sort((left, right) => {
      const leftPriority = Number(left?.priority || 0);
      const rightPriority = Number(right?.priority || 0);
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      return String(left?.issueId || '').localeCompare(String(right?.issueId || ''), 'zh-CN');
    });
  });

  return {
    issues,
    issuesByGroupKey,
    markerIndexByPath,
  };
};
