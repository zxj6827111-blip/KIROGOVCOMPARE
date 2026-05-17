const normalizeText = (value) => String(value || '').toLowerCase();

const isConsistentIssue = (issueType) => normalizeText(issueType).startsWith('consistency_');

export const resolveIssueTone = ({
  source = '',
  issueType = '',
  tone = '',
  humanStatus = '',
}) => {
  if (tone) return tone;

  const normalizedSource = normalizeText(source);
  const normalizedIssueType = normalizeText(issueType);
  const normalizedHumanStatus = normalizeText(humanStatus);

  if (normalizedSource === 'quality' || normalizedIssueType.startsWith('quality_')) {
    return 'quality';
  }

  if (normalizedIssueType === 'source_anomaly') {
    return 'ocr';
  }

  if (normalizedSource === 'vision' || normalizedIssueType === 'ocr_review') {
    if (normalizedIssueType === 'ocr_review_success' || normalizedHumanStatus === 'confirmed') {
      return 'success';
    }
    return 'ocr';
  }

  if (normalizedSource === 'ocr' || normalizedIssueType === 'ocr_correction') {
    if (normalizedHumanStatus === 'confirmed') {
      return 'success';
    }
    if (normalizedHumanStatus === 'dismissed' || normalizedHumanStatus === 'rejected') {
      return 'neutral';
    }
    return 'ocr';
  }

  if (normalizedSource === 'diagnostics' || normalizedIssueType === 'table_split_hint') {
    return 'diagnostics';
  }

  if (normalizedIssueType === 'unsupported_not_assessable') {
    return 'neutral';
  }

  if (isConsistentIssue(normalizedIssueType)) {
    return 'consistency';
  }

  return 'neutral';
};

export const resolveIssuePriority = ({
  source = '',
  issueType = '',
  tone = '',
  autoStatus = '',
  humanStatus = '',
  role = '',
}) => {
  const normalizedSource = normalizeText(source);
  const normalizedIssueType = normalizeText(issueType);
  const normalizedTone = resolveIssueTone({ source, issueType, tone, humanStatus });
  const normalizedAutoStatus = String(autoStatus || '').toUpperCase();
  const normalizedHumanStatus = normalizeText(humanStatus);

  if (normalizedSource === 'checks' || isConsistentIssue(normalizedIssueType)) {
    if (normalizedAutoStatus === 'FAIL') {
      return role === 'related' ? 90 : 100;
    }
    if (normalizedAutoStatus === 'UNCERTAIN') {
      return 70;
    }
    if (normalizedAutoStatus === 'NOT_ASSESSABLE') {
      return 0;
    }
    return 80;
  }

  if (normalizedSource === 'quality' || normalizedTone === 'quality') {
    return 50;
  }

  if (normalizedSource === 'vision' || normalizedIssueType === 'ocr_review') {
    if (
      normalizedIssueType === 'ocr_review_success' ||
      normalizedTone === 'success' ||
      normalizedHumanStatus === 'confirmed'
    ) {
      return 35;
    }
    return 40;
  }

  if (normalizedSource === 'ocr' || normalizedIssueType === 'ocr_correction') {
    if (normalizedHumanStatus === 'confirmed' || normalizedTone === 'success') {
      return 35;
    }
    if (normalizedHumanStatus === 'dismissed' || normalizedHumanStatus === 'rejected') {
      return 0;
    }
    return 40;
  }

  if (normalizedSource === 'diagnostics' || normalizedIssueType === 'table_split_hint' || normalizedTone === 'diagnostics') {
    return 10;
  }

  if (normalizedAutoStatus === 'NOT_ASSESSABLE' || normalizedTone === 'neutral') {
    return 0;
  }

  return 0;
};

export const resolveIssueLineStyle = ({
  source = '',
  issueType = '',
  tone = '',
  humanStatus = '',
}) => {
  const normalizedSource = normalizeText(source);
  const normalizedIssueType = normalizeText(issueType);
  const normalizedTone = resolveIssueTone({ source, issueType, tone, humanStatus });

  if (normalizedSource === 'diagnostics' || normalizedIssueType === 'table_split_hint' || normalizedTone === 'diagnostics') {
    return 'dashed';
  }

  return 'solid';
};

export const buildMarkerShell = ({
  path,
  role = 'context',
  issueType = 'unknown',
  source = 'checks',
  tone,
  lineStyle,
  displayNo = null,
  priority,
  issueId = null,
  autoStatus = '',
  humanStatus = '',
}) => ({
  path,
  role,
  issueType,
  source,
  tone: resolveIssueTone({ source, issueType, tone, humanStatus }),
  lineStyle: lineStyle || resolveIssueLineStyle({ source, issueType, tone, humanStatus }),
  displayNo: displayNo ?? null,
  priority: priority ?? resolveIssuePriority({ source, issueType, tone, autoStatus, humanStatus, role }),
  issueId: issueId ?? null,
});

export const sortMarkersByPriority = (markers = []) =>
  [...markers].sort((left, right) => {
    const leftPriority = left?.priority ?? 0;
    const rightPriority = right?.priority ?? 0;
    if (leftPriority !== rightPriority) return rightPriority - leftPriority;

    const leftPath = String(left?.path || '');
    const rightPath = String(right?.path || '');
    if (leftPath !== rightPath) return leftPath.localeCompare(rightPath, 'zh-CN');

    const leftIssueId = String(left?.issueId || '');
    const rightIssueId = String(right?.issueId || '');
    return leftIssueId.localeCompare(rightIssueId, 'zh-CN');
  });
