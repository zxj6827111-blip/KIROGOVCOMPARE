import { buildMarkerShell, sortMarkersByPriority } from './issueMarkerPriority';
import { normalizeIssueItem } from './issueViewModelAdapter';

const safeArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

export const normalizeDiagnosticsIssueItem = (entry, options = {}) => {
  const issueId = options.issueId || `diagnostics:${entry?.key || entry?.path || 'unknown'}`;
  const paths = safeArray(entry?.paths || entry?.markerPaths || [entry?.path]);
  const markers = options.markers || sortMarkersByPriority(
    paths.map((path, index) =>
      buildMarkerShell({
        path,
        role: index === 0 ? 'primary' : 'context',
        issueType: 'table_split_hint',
        source: 'diagnostics',
        tone: 'diagnostics',
        lineStyle: 'dashed',
        displayNo: null,
        priority: 10,
        issueId,
        humanStatus: 'pending',
      })
    )
  );

  return normalizeIssueItem(
    {
      id: entry?.id ?? null,
      group_key: options.groupKey || 'table3',
      check_key: entry?.key || 'table_split_hint',
      issueType: 'table_split_hint',
      title: entry?.title || entry?.message || 'table split hint',
      auto_status: 'UNCERTAIN',
      human_status: 'pending',
      evidence: { paths },
    },
    {
      ...options,
      source: 'diagnostics',
      issueType: 'table_split_hint',
      issueId,
      stableIssueId: issueId,
      displayNo: null,
      severity: 'warning',
      tone: 'diagnostics',
      markers,
      priority: 10,
      tableId: options.tableId || 'table_3',
    }
  );
};

export const normalizeDiagnosticsIssueGroups = (diagnostics = null) => {
  if (!diagnostics) {
    return { issues: [], issuesByGroupKey: {}, markerIndexByPath: {} };
  }

  const issues = [];
  const issuesByGroupKey = { diagnostics: [] };
  const markerIndexByPath = {};

  const addIssue = (entry) => {
    const issue = normalizeDiagnosticsIssueItem(entry, { groupKey: 'diagnostics' });
    issues.push(issue);
    issuesByGroupKey.diagnostics.push(issue);
    issue.markers.forEach((marker) => {
      if (!marker?.path) return;
      if (!markerIndexByPath[marker.path]) markerIndexByPath[marker.path] = [];
      markerIndexByPath[marker.path].push(issue);
    });
  };

  (diagnostics.suspiciousRows || []).forEach((row) => {
    addIssue({
      id: row?.key || row?.rowLabel || row?.title,
      key: row?.key,
      title: row?.title || row?.message || row?.rowLabel || 'table split hint',
      message: row?.message,
      paths: safeArray((row?.candidates || []).flatMap((candidate) => [candidate?.leftPath, candidate?.rightPath]).filter(Boolean)),
    });
  });

  if (diagnostics.suspiciousByPath instanceof Map) {
    diagnostics.suspiciousByPath.forEach((value, path) => {
      addIssue({
        id: `path:${path}`,
        key: value?.type || 'table_split_hint',
        title: value?.title || value?.rowLabel || 'table split hint',
        message: value?.marker || value?.type || 'table split hint',
        paths: [path],
      });
    });
  }

  Object.keys(markerIndexByPath).forEach((path) => {
    markerIndexByPath[path] = markerIndexByPath[path].sort((left, right) => {
      const leftPriority = Number(left?.priority || 0);
      const rightPriority = Number(right?.priority || 0);
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      return String(left?.issueId || '').localeCompare(String(right?.issueId || ''), 'zh-CN');
    });
  });

  return { issues, issuesByGroupKey, markerIndexByPath };
};
