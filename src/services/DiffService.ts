import { DiffResult, DiffSection, DiffParagraph, DiffTable, CellChange } from '../types/models';
import { StructuredDocument, Section, Paragraph, Table } from '../types/models';
import { DiffType } from '../types';

export interface DiffOptions {
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
}

export class DiffService {
  /**
   * 比对两份结构化文档
   */
  async diffDocuments(
    docA: StructuredDocument,
    docB: StructuredDocument,
    options: DiffOptions = {}
  ): Promise<DiffResult> {
    const sections: DiffSection[] = [];

    // 比对章节
    const sectionMap = this.mapSections(docB.sections);

    for (const sectionA of docA.sections) {
      const sectionB = sectionMap.get(sectionA.title);
      const diffSection = await this.diffSection(sectionA, sectionB, options);
      sections.push(diffSection);
    }

    // 处理B中新增的章节
    for (const sectionB of docB.sections) {
      if (!docA.sections.find((s) => s.title === sectionB.title)) {
        const diffSection = this.createAddedSection(sectionB);
        sections.push(diffSection);
      }
    }

    return { sections };
  }

  /**
   * 比对单个章节
   */
  private async diffSection(
    sectionA: Section | undefined,
    sectionB: Section | undefined,
    options: DiffOptions
  ): Promise<DiffSection> {
    const sectionId = sectionA?.id || sectionB?.id || `section_${Date.now()}`;
    const sectionTitle = sectionA?.title || sectionB?.title || '';
    const level = sectionA?.level || sectionB?.level || 1;

    const paragraphs: DiffParagraph[] = [];
    const tables: DiffTable[] = [];
    const subsections: DiffSection[] = [];

    if (!sectionA && sectionB) {
      // 新增章节
      return this.createAddedSection(sectionB);
    }

    if (sectionA && !sectionB) {
      // 删除章节
      return this.createDeletedSection(sectionA);
    }

    if (sectionA && sectionB) {
      // 比对段落
      const paragraphDiffs = this.diffParagraphs(
        sectionA.content || [],
        sectionB.content || [],
        options
      );
      paragraphs.push(...paragraphDiffs);

      // 比对表格
      const tableDiffs = this.diffTables(sectionA.tables || [], sectionB.tables || []);
      tables.push(...tableDiffs);

      // 比对子章节
      const subsectionMap = this.mapSections(sectionB.subsections || []);
      for (const subsectionA of sectionA.subsections || []) {
        const subsectionB = subsectionMap.get(subsectionA.title);
        const diffSubsection = await this.diffSection(subsectionA, subsectionB, options);
        subsections.push(diffSubsection);
      }

      // 处理B中新增的子章节
      for (const subsectionB of sectionB.subsections || []) {
        if (!(sectionA.subsections || []).find((s) => s.title === subsectionB.title)) {
          const diffSubsection = this.createAddedSection(subsectionB);
          subsections.push(diffSubsection);
        }
      }
    }

    return {
      sectionId,
      sectionTitle,
      level,
      paragraphs,
      tables,
      subsections: subsections.length > 0 ? subsections : undefined,
    };
  }

  /**
   * 比对段落列表
   */
  private diffParagraphs(
    paragraphsA: Paragraph[],
    paragraphsB: Paragraph[],
    options: DiffOptions
  ): DiffParagraph[] {
    const diffs: DiffParagraph[] = [];
    const textA = paragraphsA.map((p) => this.normalizeText(p.text, options));
    const textB = paragraphsB.map((p) => this.normalizeText(p.text, options));

    // 简单的LCS算法用于段落匹配
    const lcs = this.longestCommonSubsequence(textA, textB);
    const matched = new Set<number>();

    for (const [idxA, idxB] of lcs) {
      matched.add(idxA);
      matched.add(idxB);

      // 检查是否修改
      if (textA[idxA] !== textB[idxB]) {
        diffs.push({
          id: `para_${idxA}_${idxB}`,
          type: 'modified',
          before: paragraphsA[idxA].text,
          after: paragraphsB[idxB].text,
          anchor: `para_${idxA}`,
        });
      }
    }

    // 处理删除的段落
    for (let i = 0; i < paragraphsA.length; i++) {
      if (!matched.has(i)) {
        diffs.push({
          id: `para_del_${i}`,
          type: 'deleted',
          before: paragraphsA[i].text,
          anchor: `para_${i}`,
        });
      }
    }

    // 处理新增的段落
    for (let i = 0; i < paragraphsB.length; i++) {
      if (!matched.has(i)) {
        diffs.push({
          id: `para_add_${i}`,
          type: 'added',
          after: paragraphsB[i].text,
          anchor: `para_${i}`,
        });
      }
    }

    return diffs;
  }

  /**
   * 比对表格列表
   */
  private diffTables(tablesA: Table[], tablesB: Table[]): DiffTable[] {
    const diffs: DiffTable[] = [];
    const tableMap = new Map<string, Table>();

    for (const table of tablesB) {
      tableMap.set(table.title || table.id, table);
    }

    // 比对现有表格
    for (const tableA of tablesA) {
      const tableB = tableMap.get(tableA.title || tableA.id);
      if (tableB) {
        const tableDiff = this.diffTable(tableA, tableB);
        diffs.push(tableDiff);
      } else {
        // 删除的表格
        diffs.push({
          tableId: tableA.id,
          type: 'deleted',
          alignmentQuality: 'perfect',
          cellChanges: [],
        });
      }
    }

    // 处理新增的表格
    for (const tableB of tablesB) {
      if (!tablesA.find((t) => (t.title || t.id) === (tableB.title || tableB.id))) {
        diffs.push({
          tableId: tableB.id,
          type: 'added',
          alignmentQuality: 'perfect',
          cellChanges: [],
        });
      }
    }

    return diffs;
  }

  /**
   * 比对单个表格
   */
  private diffTable(tableA: Table, tableB: Table): DiffTable {
    const cellChanges: CellChange[] = [];
    const maxRows = Math.max(tableA.rows.length, tableB.rows.length);
    const maxCols = Math.max(tableA.columns, tableB.columns);

    let alignmentQuality: 'perfect' | 'partial' | 'failed' = 'perfect';

    // 检查表格结构是否一致
    if (tableA.rows.length !== tableB.rows.length || tableA.columns !== tableB.columns) {
      alignmentQuality = 'partial';
    }

    // 比对单元格
    for (let row = 0; row < maxRows; row++) {
      for (let col = 0; col < maxCols; col++) {
        const cellA = tableA.rows[row]?.cells[col];
        const cellB = tableB.rows[row]?.cells[col];
        
        // 获取行标签和列名（来自 schema）
        const rowLabel = tableA.rows[row]?.rowLabel || tableB.rows[row]?.rowLabel || '';
        const colName = tableA.rows[row]?.cells[col]?.colName || tableB.rows[row]?.cells[col]?.colName || '';

        if (!cellA && cellB) {
          cellChanges.push({
            rowIndex: row,
            colIndex: col,
            rowLabel,
            colName,
            type: 'added',
            after: cellB.content,
          });
        } else if (cellA && !cellB) {
          cellChanges.push({
            rowIndex: row,
            colIndex: col,
            rowLabel,
            colName,
            type: 'deleted',
            before: cellA.content,
          });
        } else if (cellA && cellB && cellA.content !== cellB.content) {
          cellChanges.push({
            rowIndex: row,
            colIndex: col,
            rowLabel,
            colName,
            type: 'modified',
            before: cellA.content,
            after: cellB.content,
          });
        }
      }
    }

    return {
      tableId: tableA.id,
      type: cellChanges.length > 0 ? 'modified' : 'modified',
      alignmentQuality,
      cellChanges,
    };
  }

  /**
   * 创建新增章节的差异
   */
  private createAddedSection(section: Section): DiffSection {
    return {
      sectionId: section.id,
      sectionTitle: section.title,
      level: section.level,
      paragraphs: (section.content || []).map((p, i) => ({
        id: `para_add_${i}`,
        type: 'added' as DiffType,
        after: p.text,
        anchor: `para_${i}`,
      })),
      tables: (section.tables || []).map((t) => ({
        tableId: t.id,
        type: 'added' as DiffType,
        alignmentQuality: 'perfect' as const,
        cellChanges: [],
      })),
      subsections: (section.subsections || []).map((s) => this.createAddedSection(s)),
    };
  }

  /**
   * 创建删除章节的差异
   */
  private createDeletedSection(section: Section): DiffSection {
    return {
      sectionId: section.id,
      sectionTitle: section.title,
      level: section.level,
      paragraphs: (section.content || []).map((p, i) => ({
        id: `para_del_${i}`,
        type: 'deleted' as DiffType,
        before: p.text,
        anchor: `para_${i}`,
      })),
      tables: (section.tables || []).map((t) => ({
        tableId: t.id,
        type: 'deleted' as DiffType,
        alignmentQuality: 'perfect' as const,
        cellChanges: [],
      })),
      subsections: (section.subsections || []).map((s) => this.createDeletedSection(s)),
    };
  }

  /**
   * 规范化文本用于比对
   */
  private normalizeText(text: string, options: DiffOptions): string {
    let normalized = text;

    if (options.ignoreWhitespace) {
      normalized = normalized.replace(/\s+/g, ' ').trim();
    }

    if (options.ignoreCase) {
      normalized = normalized.toLowerCase();
    }

    return normalized;
  }

  /**
   * 最长公共子序列算法
   */
  private longestCommonSubsequence(
    a: string[],
    b: string[]
  ): Array<[number, number]> {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // 回溯找出匹配的索引对
    const result: Array<[number, number]> = [];
    let i = m;
    let j = n;

    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        result.unshift([i - 1, j - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return result;
  }

  /**
   * 将章节映射为Map便于查找
   */
  private mapSections(sections: Section[]): Map<string, Section> {
    const map = new Map<string, Section>();
    for (const section of sections) {
      map.set(section.title, section);
    }
    return map;
  }
}

export default new DiffService();
