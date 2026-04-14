import fs from 'fs/promises';
import path from 'path';
import { load } from 'cheerio';

export interface ExtractedAnnualReportSummary {
  title: string;
  publishDate: string;
  highlights: string[];
  problemSnippets: string[];
  improvements: string[];
  sections: {
    proactiveDisclosure: string;
    requestDisclosure: string;
    platformConstruction: string;
    supervision: string;
    problems: string;
    improvements: string;
  };
}

export const normalizePlainText = (input: string): string =>
  String(input || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();

const sliceBetween = (text: string, startMarkers: string[], endMarkers: string[]): string => {
  const normalized = normalizePlainText(text);
  let startIndex = -1;
  let startLength = 0;

  for (const marker of startMarkers) {
    const idx = normalized.indexOf(marker);
    if (idx >= 0 && (startIndex === -1 || idx < startIndex)) {
      startIndex = idx;
      startLength = marker.length;
    }
  }

  if (startIndex === -1) return '';

  const rest = normalized.slice(startIndex + startLength);
  let endIndex = rest.length;

  for (const marker of endMarkers) {
    const idx = rest.indexOf(marker);
    if (idx >= 0 && idx < endIndex) {
      endIndex = idx;
    }
  }

  return rest.slice(0, endIndex).trim();
};

export const cleanExcerpt = (text: string, limit = 220): string => {
  const normalized = normalizePlainText(text);
  if (!normalized) return '';
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
};

export const extractAnnualReportSummary = (rawText: string): ExtractedAnnualReportSummary => {
  const text = normalizePlainText(rawText);
  const titleCandidates = Array.from(text.matchAll(/([^\n|]{4,}政府信息公开工作年度报告)/g))
    .map((match) => normalizePlainText(match[1]).replace(/^.*信息公开\s+/, '').trim())
    .filter(Boolean)
    .sort((a, b) => a.length - b.length);
  const publishDateMatch = text.match(/公开日期[：:\s|]*([0-9]{4}-[0-9]{2}-[0-9]{2})/);

  const proactive = sliceBetween(
    text,
    ['（一）主动公开情况。', '（一）主动公开情况'],
    ['（二）依申请公开情况。', '（二）依申请公开情况']
  );
  const request = sliceBetween(
    text,
    ['（二）依申请公开情况。', '（二）依申请公开情况'],
    ['（三）政府信息管理情况。', '（三）政府信息管理情况']
  );
  const platform = sliceBetween(
    text,
    ['（四）政府信息公开平台建设情况。', '（四）政府信息公开平台建设情况'],
    ['（五）政府信息公开监督保障情况。', '（五）政府信息公开监督保障情况']
  );
  const supervision = sliceBetween(
    text,
    ['（五）政府信息公开监督保障情况。', '（五）政府信息公开监督保障情况'],
    ['二、主动公开政府信息情况', '二、主动公开政府信息情况。']
  );
  const problems = sliceBetween(
    text,
    ['五、存在的主要问题及改进情况', '五、存在的主要问题及改进情况。'],
    ['六、其他需要报告的事项', '六、其他需要报告的事项。']
  );

  const highlights = [cleanExcerpt(proactive), cleanExcerpt(platform), cleanExcerpt(supervision)].filter(Boolean);

  const problemSnippets = problems
    ? problems
        .split(/[。；]/)
        .map((item) => normalizePlainText(item))
        .filter(Boolean)
        .slice(0, 3)
    : [];

  const improvementMatch = problems.match(/针对(?:上述)?问题[^。；]*[。；]?(.+)/);
  const improvements = improvementMatch
    ? improvementMatch[1]
        .split(/[。；]/)
        .map((item) => normalizePlainText(item))
        .filter(Boolean)
        .slice(0, 3)
    : [];

  return {
    title: titleCandidates[0] || '',
    publishDate: publishDateMatch?.[1] || '',
    sections: {
      proactiveDisclosure: cleanExcerpt(proactive, 360),
      requestDisclosure: cleanExcerpt(request, 360),
      platformConstruction: cleanExcerpt(platform, 300),
      supervision: cleanExcerpt(supervision, 300),
      problems: cleanExcerpt(problems, 360),
      improvements: improvements.join('；'),
    },
    highlights,
    problemSnippets,
    improvements,
  };
};

export const loadTextFromStoragePath = async (storagePath: string): Promise<string> => {
  if (!storagePath) return '';
  const resolvedPath = path.resolve(process.cwd(), storagePath.replace(/\\/g, path.sep));
  const extension = path.extname(resolvedPath).toLowerCase();

  if (extension !== '.html' && extension !== '.htm' && extension !== '.txt' && extension !== '.md') {
    return '';
  }

  const content = await fs.readFile(resolvedPath, 'utf8');
  if (extension === '.html' || extension === '.htm') {
    const $ = load(content);
    return normalizePlainText($.root().text());
  }

  return normalizePlainText(content);
};
