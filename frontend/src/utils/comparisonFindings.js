const DEFAULT_REFERENCE_THRESHOLD = 60;
const DEFAULT_MAJOR_CHANGE_THRESHOLD = 40;

const toValidPercent = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
};

const normalizeSummaryItems = (items) => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
};

const normalizeTitleIssues = (issues) => {
  if (!Array.isArray(issues)) return [];
  return issues
    .map((issue) => {
      const title = String(issue?.title || '').trim();
      const normalizedTitle = String(issue?.normalizedTitle || issue?.normalized_title || '').trim();
      if (!title || !normalizedTitle || title === normalizedTitle) return null;
      return `原报告章节标题疑似有误：“${title}”已按“${normalizedTitle}”参与比对。`;
    })
    .filter(Boolean);
};

const buildSectionFinding = (metric, referenceThreshold, majorChangeThreshold) => {
  const similarity = toValidPercent(metric?.similarity);
  if (similarity == null || similarity >= referenceThreshold) return null;

  const title = metric?.title || '未命名正文章节';
  if (similarity < majorChangeThreshold) {
    return `${title}：正文重复率 ${similarity}%，文字变化较大，建议重点复核。`;
  }

  return `${title}：正文重复率 ${similarity}%，低于 ${referenceThreshold}% 参考线，建议关注新增或改写内容。`;
};

export const buildComparisonFindingItems = ({
  summaryItems,
  textSectionMetrics,
  titleIssues,
  referenceThreshold = DEFAULT_REFERENCE_THRESHOLD,
  majorChangeThreshold = DEFAULT_MAJOR_CHANGE_THRESHOLD,
} = {}) => {
  const items = normalizeSummaryItems(summaryItems);
  const titleIssueItems = normalizeTitleIssues(titleIssues);
  const metrics = Array.isArray(textSectionMetrics) ? textSectionMetrics : [];

  const sectionFindings = metrics
    .map((metric) => buildSectionFinding(metric, referenceThreshold, majorChangeThreshold))
    .filter(Boolean);

  const merged = [...items, ...titleIssueItems, ...sectionFindings];
  if (merged.length > 0) return merged;

  if (metrics.length > 0) {
    return [`暂无低于 ${referenceThreshold}% 参考线的正文章节，仍可结合黄底高亮和下方数据检查结果复核。`];
  }

  return ['暂无结构化差异摘要；可结合下方正文高亮和数据检查结果复核。'];
};
