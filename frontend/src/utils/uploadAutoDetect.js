export const normalizeDetectionText = (input) =>
  String(input || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();

const compactDetectionText = (input) => normalizeDetectionText(input).replace(/\s+/g, '');

const COMMON_UNIT_SUFFIX_RE =
  /(?:人民政府|管理委员会|管委会|办事处|发展和改革局|发展改革委|发展改革局|税务局|教育局|财政局|公安局|司法局|民政局|审计局|统计局|市场监督管理局|卫生健康委员会|卫生健康局|应急管理局|行政审批局|政务服务管理办公室)$/;

const normalizeDetectedUnitName = (input) => {
  const value = String(input || '').replace(/[：:]+$/, '').trim();
  return value.replace(/\s+/g, '');
};

export const extractYearFromFilename = (filename) => {
  const match = String(filename || '').match(/(\d{4})/);
  if (!match) return null;
  const detectedYear = Number(match[1]);
  if (detectedYear >= 2000 && detectedYear <= 2050) {
    return detectedYear;
  }
  return null;
};

export const extractYearFromText = (text) => {
  const compact = compactDetectionText(text);
  const match = compact.match(/(20\d{2})年/);
  if (!match) return null;
  const detectedYear = Number(match[1]);
  if (detectedYear >= 2000 && detectedYear <= 2050) {
    return detectedYear;
  }
  return null;
};

export const extractUnitNameFromText = (text) => {
  const compact = compactDetectionText(text);
  if (!compact) return '';

  const titleMatch = compact.match(/([^-]{2,80}?政府信息公开(?:工作)?年度报告)(?:[-—](.{2,40}))?/);
  if (titleMatch) {
    const title = titleMatch[1];
    const suffixName = normalizeDetectedUnitName(titleMatch[2] || '');
    if (suffixName) {
      return suffixName;
    }

    const prefixMatch = title.match(/^(.+?)(?:20\d{2}年)?政府信息公开(?:工作)?年度报告/);
    if (prefixMatch?.[1]) {
      return normalizeDetectedUnitName(prefixMatch[1]);
    }
  }

  const patterns = [
    /(.{2,40}?(?:市|区|县|旗|省|镇|乡|街道)(?:人民政府|管理委员会|管委会|办事处))/,
    /(.{2,40}?(?:市|区|县|旗|省).{1,20}?(?:局|委员会|委|办|所|中心))/,
    /^(.{2,40}?)政府信息公开(?:工作)?年度报告/,
  ];

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (match?.[1]) {
      return normalizeDetectedUnitName(match[1]);
    }
  }

  return '';
};

export const extractRegionFromFilename = (filename) => {
  let name = String(filename || '').replace(/\.(pdf|html|htm|txt|md|markdown)$/i, '');
  name = name.replace(/[-_]\d{4}-\d{2}-\d{2}$/, '');

  const townPatterns = [
    /([\u4e00-\u9fa5]{2,6}(?:镇|乡|街道|办事处))(?:\d{4}年|政府信息|年度报告)/,
    /(?:[\u4e00-\u9fa5]{2,4}县)([\u4e00-\u9fa5]{2,6}(?:镇|乡|街道|办事处))/,
    /[-_]([\u4e00-\u9fa5]{2,4}县[\u4e00-\u9fa5]{2,6}(?:镇|乡|街道))/,
  ];
  for (const pattern of townPatterns) {
    const match = name.match(pattern);
    if (match?.[1]) {
      return normalizeDetectedUnitName(match[1]);
    }
  }

  const deptPatterns = [
    /(国家税务总局[\u4e00-\u9fa5]{2,6}(?:市|区|县)税务局)(?:\d{4}年|年度|政府信息)/,
    /([\u4e00-\u9fa5]{2,4}(?:省|市|区|县)[\u4e00-\u9fa5]{2,15}(?:局|委员会|委|办|中心|所))(?:\d{4}年|年度|政府信息)/,
    /[-_]([\u4e00-\u9fa5]{2,4}(?:市|区|县)[\u4e00-\u9fa5]{2,15}(?:局|委员会|委|办|中心|所))(?:[-_]|$)/,
    /^([\u4e00-\u9fa5]{2,4}(?:市|区|县)[\u4e00-\u9fa5]{2,15}(?:局|委员会|委|办|中心|所))\d{4}/,
  ];
  for (const pattern of deptPatterns) {
    const match = name.match(pattern);
    if (match?.[1]) {
      return normalizeDetectedUnitName(match[1]);
    }
  }

  const patterns = [
    /^(.{2,30}(?:市|区|县|省|镇|乡|街道|办事处|管理委员会))(?:\d{4})?/,
    /\d{4}年?(.{2,30}(?:市|区|县|省|镇|乡|街道|办事处|管理委员会))/,
    /^(.{2,30}(?:市|区|县|省|街道|镇|乡))(?:\d{4}年)?(?:(?:人民)?政府|办事处|管理委员会)/,
    /(.{2,20}(?:市|区|县|街道|办事处|镇|乡|局|委员会|委|办))/,
  ];
  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match?.[1]) {
      const detected = normalizeDetectedUnitName(match[1]).replace(/\d+/g, '');
      if (detected.length >= 2) {
        return detected;
      }
    }
  }

  return null;
};

export const stripCommonUnitSuffix = (value) =>
  normalizeDetectedUnitName(value).replace(COMMON_UNIT_SUFFIX_RE, '');
