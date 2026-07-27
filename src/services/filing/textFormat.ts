/**
 * Body-text one-click formatting for annual report narrative sections.
 * Does not generate PDF/DOCX layout — only normalizes paragraphs.
 */
export function formatAnnualReportText(input: string): string {
  if (input == null) return '';
  let formatted = String(input);

  formatted = formatted.replace(/\s+/g, ' ').trim();
  formatted = formatted.replace(/([。！？])\s*/g, '$1\n');
  formatted = formatted.replace(
    /([^\n])\s*([一二三四五六七八九十]+、|\([一二三四五六七八九十]+\)|（[一二三四五六七八九十]+）)/g,
    '$1\n\n$2'
  );
  formatted = formatted.replace(/\n{3,}/g, '\n\n');
  formatted = formatted
    .split('\n')
    .map((line) => line.trim())
    .join('\n');

  return formatted;
}

export function formatAllTextSections(formJson: any): any {
  const clone = JSON.parse(JSON.stringify(formJson || { sections: [] }));
  if (!Array.isArray(clone.sections)) return clone;
  for (const section of clone.sections) {
    if (section?.type === 'text' && typeof section.content === 'string') {
      section.content = formatAnnualReportText(section.content);
    }
  }
  return clone;
}
