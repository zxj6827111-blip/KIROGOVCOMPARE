/**
 * 差异视图服务
 * 为前端提供对照视图数据（全文对照、表格对照）
 */

import { DiffResult, StructuredDocument } from '../types/models';
import DiffMatchPatch from 'diff-match-patch';

export interface ViewBlock {
  type: 'paragraph' | 'table';
  status?: 'same' | 'modified' | 'added' | 'deleted';
  beforeText?: string;
  afterText?: string;
  inlineDiff?: InlineDiffSpan[];
  tableData?: TableViewData;
}

export interface InlineDiffSpan {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

export interface TableViewData {
  schemaTableId: string;
  tableA: any;
  tableB: any;
  cellDiffs: CellDiffInfo[];
  metricsDiffs: MetricDiff[];
}

export interface CellDiffInfo {
  rowIndex: number;
  colIndex: number;
  rowLabel?: string;
  colName?: string;
  beforeValue: string;
  afterValue: string;
  status: 'same' | 'modified' | 'added' | 'deleted';
}

export interface MetricDiff {
  rowLabel: string;
  beforeValue: string | number;
  afterValue: string | number;
  delta?: string | number;
  deltaPercent?: number;
}

export interface ViewSection {
  sectionId: string;
  sectionTitle: string;
  level: number;
  blocks: ViewBlock[];
}

export interface DiffViewModel {
  taskId: string;
  sections: ViewSection[];
}

export class DiffViewService {
  private dmp: any;

  constructor() {
    // 初始化 diff-match-patch
    this.dmp = new DiffMatchPatch();
  }

  /**
   * 生成对照视图数据
   * 用于前端全文对照和表格对照展示
   */
  generateViewModel(
    diffResult: DiffResult,
    docA: StructuredDocument,
    docB: StructuredDocument
  ): DiffViewModel {
    const sections: ViewSection[] = [];

    for (const diffSection of diffResult.sections) {
      const blocks: ViewBlock[] = [];

      // 处理段落
      for (const para of diffSection.paragraphs) {
        blocks.push({
          type: 'paragraph',
          status: para.type as any,
          beforeText: para.before,
          afterText: para.after,
          inlineDiff: this.generateInlineDiff(para.before || '', para.after || ''),
        });
      }

      // 处理表格
      for (const table of diffSection.tables) {
        blocks.push({
          type: 'table',
          status: table.type as any,
          tableData: this.generateTableViewData(table),
        });
      }

      sections.push({
        sectionId: diffSection.sectionId,
        sectionTitle: diffSection.sectionTitle,
        level: diffSection.level,
        blocks,
      });
    }

    return {
      taskId: 'task_id_placeholder',
      sections,
    };
  }

  /**
   * 生成行内差异高亮数据
   * 使用 diff-match-patch 库进行精确的字符级别 diff
   */
  private generateInlineDiff(beforeText: string, afterText: string): InlineDiffSpan[] {
    if (!beforeText && !afterText) {
      return [];
    }

    if (!beforeText) {
      return [{ type: 'insert', text: afterText }];
    }

    if (!afterText) {
      return [{ type: 'delete', text: beforeText }];
    }

    try {
      // 使用 diff-match-patch 生成差异
      const diffs = this.dmp.diff_main(beforeText, afterText);
      this.dmp.diff_cleanupSemantic(diffs);

      // 转换为 InlineDiffSpan 格式
      const spans: InlineDiffSpan[] = diffs.map((diff: any[]) => {
        const [type, text] = diff;
        if (type === 0) {
          return { type: 'equal', text };
        } else if (type === 1) {
          return { type: 'insert', text };
        } else {
          return { type: 'delete', text };
        }
      });

      return spans;
    } catch (error) {
      // 降级处理：如果 diff-match-patch 失败，使用简单的字符级别 diff
      console.warn('diff-match-patch 处理失败，使用降级方案:', error);
      return this.generateSimpleInlineDiff(beforeText, afterText);
    }
  }

  /**
   * 简单的字符级别 diff（降级方案）
   */
  private generateSimpleInlineDiff(beforeText: string, afterText: string): InlineDiffSpan[] {
    const spans: InlineDiffSpan[] = [];
    const minLen = Math.min(beforeText.length, afterText.length);
    let i = 0;

    // 找公共前缀
    while (i < minLen && beforeText[i] === afterText[i]) {
      i++;
    }

    if (i > 0) {
      spans.push({ type: 'equal', text: beforeText.substring(0, i) });
    }

    // 找公共后缀
    let beforeEnd = beforeText.length - 1;
    let afterEnd = afterText.length - 1;

    while (
      beforeEnd > i &&
      afterEnd > i &&
      beforeText[beforeEnd] === afterText[afterEnd]
    ) {
      beforeEnd--;
      afterEnd--;
    }

    // 中间部分
    if (i <= beforeEnd) {
      spans.push({ type: 'delete', text: beforeText.substring(i, beforeEnd + 1) });
    }

    if (i <= afterEnd) {
      spans.push({ type: 'insert', text: afterText.substring(i, afterEnd + 1) });
    }

    // 公共后缀
    if (beforeEnd < beforeText.length - 1) {
      spans.push({
        type: 'equal',
        text: beforeText.substring(beforeEnd + 1),
      });
    }

    return spans;
  }

  /**
   * 生成表格视图数据
   */
  private generateTableViewData(table: any): TableViewData {
    const cellDiffs: CellDiffInfo[] = table.cellChanges.map((change: any) => ({
      rowIndex: change.rowIndex,
      colIndex: change.colIndex,
      rowLabel: change.rowLabel,
      colName: change.colName,
      beforeValue: change.before || '',
      afterValue: change.after || '',
      status: change.type,
    }));

    // 生成指标差异（仅数值列）
    const metricsDiffs = this.generateMetricsDiffs(table);

    return {
      schemaTableId: table.tableId,
      tableA: null, // 实际应传入完整表格数据
      tableB: null,
      cellDiffs,
      metricsDiffs,
    };
  }

  /**
   * 生成指标差异分析
   * 用于表格下方的差异分析表
   */
  private generateMetricsDiffs(table: any): MetricDiff[] {
    const metrics: MetricDiff[] = [];

    for (const change of table.cellChanges) {
      // 只处理数值型变化
      const beforeVal = parseFloat(change.before || '0');
      const afterVal = parseFloat(change.after || '0');

      if (!isNaN(beforeVal) && !isNaN(afterVal)) {
        const delta = afterVal - beforeVal;
        const deltaPercent =
          beforeVal !== 0 ? ((delta / beforeVal) * 100).toFixed(2) : null;

        metrics.push({
          rowLabel: change.rowLabel || `行 ${change.rowIndex}`,
          beforeValue: beforeVal,
          afterValue: afterVal,
          delta,
          deltaPercent: deltaPercent ? parseFloat(deltaPercent) : undefined,
        });
      }
    }

    return metrics;
  }

  /**
   * 过滤视图数据（仅显示差异）
   */
  filterOnlyDifferences(viewModel: DiffViewModel): DiffViewModel {
    return {
      ...viewModel,
      sections: viewModel.sections.map((section) => ({
        ...section,
        blocks: section.blocks.filter((block) => block.status !== 'same'),
      })),
    };
  }

  /**
   * 过滤视图数据（仅显示相同）
   */
  filterOnlySame(viewModel: DiffViewModel): DiffViewModel {
    return {
      ...viewModel,
      sections: viewModel.sections.map((section) => ({
        ...section,
        blocks: section.blocks.filter((block) => block.status === 'same'),
      })),
    };
  }
}

export default new DiffViewService();
