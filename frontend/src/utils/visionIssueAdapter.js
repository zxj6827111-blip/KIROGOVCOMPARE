import { buildMarkerShell, sortMarkersByPriority } from './issueMarkerPriority';
import { normalizeIssueItem, resolveIssueId } from './issueViewModelAdapter';

const safeArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

const resolveTableId = (review) => String(review?.tableId || review?.table_id || 'vision');

const normalizeReviewStatus = (review) => String(review?.status || review?.reviewStatus || 'queued').toLowerCase();

const normalizeConclusion = (review) => String(review?.conclusion || review?.comparison?.conclusion || '').toLowerCase();

export const classifyVisionIssueType = (review, correction = null) => {
  if (correction) return 'ocr_correction';
  const conclusion = normalizeConclusion(review);
  if (conclusion === 'source_table_anomaly') return 'source_anomaly';
  if (conclusion === 'source_table_matches_parse') return 'ocr_review_success';
  return 'ocr_review';
};

const buildReviewMarkers = (review, issueType, issueId, tone) => {
  const comparison = review?.comparison || {};
  const paths = [
    ...safeArray(comparison?.differences).map((item) => item?.path).filter(Boolean),
    ...safeArray(comparison?.unreadableCells),
    ...safeArray(review?.paths),
  ];

  return sortMarkersByPriority(
    paths.map((path, index) =>
      buildMarkerShell({
        path,
        role: index === 0 ? 'primary' : 'context',
        issueType,
        source: 'vision',
        tone,
        displayNo: null,
        priority: tone === 'success' ? 35 : 40,
        issueId,
        autoStatus: review?.status || '',
        humanStatus: review?.humanStatus || (tone === 'success' ? 'confirmed' : 'pending'),
      })
    )
  );
};

const buildCorrectionMarkers = (correction, issueId, tone) =>
  sortMarkersByPriority(
    [correction?.fieldPath].filter(Boolean).map((path) =>
      buildMarkerShell({
        path,
        role: 'primary',
        issueType: 'ocr_correction',
        source: 'ocr',
        tone,
        displayNo: null,
        priority: tone === 'success' ? 35 : 40,
        issueId,
        autoStatus: correction?.status || 'pending',
        humanStatus: correction?.status || 'pending',
      })
    )
  );

export const normalizeVisionReviewItem = (review, correction = null, options = {}) => {
  const isCorrection = Boolean(correction);
  const issueType = options.issueType || classifyVisionIssueType(review, correction);
  const status = normalizeReviewStatus(review);
  const humanStatus = options.humanStatus || (isCorrection ? correction?.status || 'pending' : status === 'completed' ? 'pending' : status);
  const tone =
    options.tone ||
    (issueType === 'source_anomaly'
      ? 'ocr'
      : issueType === 'ocr_review_success'
        ? 'success'
        : humanStatus === 'confirmed'
          ? 'success'
          : 'ocr');
  const tableId = options.tableId || resolveTableId(review);
  const issueId =
    options.issueId ||
    (isCorrection ? `ocr:${resolveIssueId(correction, 'ocr')}` : `vision:${tableId}:${review?.id ?? normalizeConclusion(review)}`);
  const markers = options.markers || (isCorrection ? buildCorrectionMarkers(correction, issueId, tone) : buildReviewMarkers(review, issueId, tone));
  const source = options.source || (isCorrection ? 'ocr' : 'vision');
  const autoStatus = options.autoStatus || status;
  const fieldPath = options.fieldPath || correction?.fieldPath || null;

  return normalizeIssueItem(
    {
      id: review?.id ?? correction?.id ?? null,
      group_key: tableId,
      check_key: issueType,
      issueType,
      title: review?.title || review?.comparison?.title || issueType,
      auto_status: autoStatus,
      human_status: humanStatus,
      evidence: fieldPath ? { paths: [fieldPath] } : {},
      fieldPath,
    },
    {
      ...options,
      source,
      issueId,
      stableIssueId: issueId,
      tableId,
      issueType,
      displayNo: null,
      severity: options.severity || (issueType === 'ocr_review_success' || humanStatus === 'confirmed' ? 'success' : issueType === 'source_anomaly' ? 'warning' : 'warning'),
      tone,
      markers,
      autoStatus,
      humanStatus,
      fieldPath,
      priority: options.priority || (issueType === 'ocr_review_success' || humanStatus === 'confirmed' ? 35 : issueType === 'source_anomaly' ? 40 : 40),
    }
  );
};

export const normalizeVisionReviewGroups = ({ reviews = [], corrections = [] } = {}) => {
  const issues = [];
  const issuesByGroupKey = {};
  const markerIndexByPath = {};

  reviews.forEach((review) => {
    const issue = normalizeVisionReviewItem(review, null);
    const groupKey = issue.groupKey || issue.group_key || resolveTableId(review);
    if (!issuesByGroupKey[groupKey]) issuesByGroupKey[groupKey] = [];
    issuesByGroupKey[groupKey].push(issue);
    issues.push(issue);
    issue.markers.forEach((marker) => {
      if (!marker?.path) return;
      if (!markerIndexByPath[marker.path]) markerIndexByPath[marker.path] = [];
      markerIndexByPath[marker.path].push(issue);
    });
  });

  corrections.forEach((correction) => {
    const review = reviews.find((item) => item.tableId === correction.tableId) || { tableId: correction.tableId };
    const issue = normalizeVisionReviewItem(review, correction, {
      issueType: 'ocr_correction',
      fieldPath: correction.fieldPath,
      source: 'ocr',
      humanStatus: correction.status || 'pending',
      tone: correction.status === 'confirmed' ? 'success' : 'ocr',
      severity: correction.status === 'confirmed' ? 'success' : correction.status === 'rejected' ? 'neutral' : 'warning',
      issueId: `ocr:${resolveIssueId(correction, correction.tableId || 'ocr')}`,
      tableId: resolveTableId(review),
    });
    const groupKey = issue.groupKey || issue.group_key || resolveTableId(review);
    if (!issuesByGroupKey[groupKey]) issuesByGroupKey[groupKey] = [];
    issuesByGroupKey[groupKey].push(issue);
    issues.push(issue);
    issue.markers.forEach((marker) => {
      if (!marker?.path) return;
      if (!markerIndexByPath[marker.path]) markerIndexByPath[marker.path] = [];
      markerIndexByPath[marker.path].push(issue);
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

  return { issues, issuesByGroupKey, markerIndexByPath };
};
