import {
  DiffResult,
  DiffSummary,
  TopChangedSection,
  DiffStatistics,
  KeyNumberChange,
} from '../types/models';
import { ChangeType } from '../types';

export interface SummaryOptions {
  topSectionsCount?: number;
  maxKeyNumberChanges?: number;
}

export class SummaryService {
  /**
   * 生成差异摘要
   */
  generateSummary(diffResult: DiffResult, options: SummaryOptions = {}): DiffSummary {
    const topSectionsCount = options.topSectionsCount || 5;
    const maxKeyNumberChanges = options.maxKeyNumberChanges || 10;

    // 计算统计数据
    const statistics = this.calculateStatistics(diffResult);

    // 获取变化最多的章节
    const topChangedSections = this.getTopChangedSections(diffResult, topSectionsCount);

    // 提取关键数字变化
    const keyNumberChanges = this.extractKeyNumberChanges(diffResult, maxKeyNumberChanges);

    // 生成总体评估
    const overallAssessment = this.generateAssessment(statistics);

    return {
      topChangedSections,
      statistics,
      keyNumberChanges,
      overallAssessment,
    };
  }

  /**
   * 计算统计数据
   */
  private calculateStatistics(diffResult: DiffResult): DiffStatistics {
    let addedParagraphs = 0;
    let deletedParagraphs = 0;
    let modifiedParagraphs = 0;
    let addedTables = 0;
    let deletedTables = 0;
    let modifiedTables = 0;

    const countSection = (section: any) => {
      // 计算段落
      for (const para of section.paragraphs || []) {
        if (para.type === 'added') addedParagraphs++;
        else if (para.type === 'deleted') deletedParagraphs++;
        else if (para.type === 'modified') modifiedParagraphs++;
      }

      // 计算表格
      for (const table of section.tables || []) {
        if (table.type === 'added') addedTables++;
        else if (table.type === 'deleted') deletedTables++;
        else if (table.type === 'modified') modifiedTables++;
      }

      // 递归计算子章节
      for (const subsection of section.subsections || []) {
        countSection(subsection);
      }
    };

    for (const section of diffResult.sections) {
      countSection(section);
    }

    return {
      addedParagraphs,
      deletedParagraphs,
      modifiedParagraphs,
      addedTables,
      deletedTables,
      modifiedTables,
    };
  }

  /**
   * 获取变化最多的章节
   */
  private getTopChangedSections(
    diffResult: DiffResult,
    topCount: number
  ): TopChangedSection[] {
    const sectionChanges: Map<string, TopChangedSection> = new Map();

    const countSectionChanges = (section: any) => {
      let added = 0;
      let deleted = 0;
      let modified = 0;

      for (const para of section.paragraphs || []) {
        if (para.type === 'added') added++;
        else if (para.type === 'deleted') deleted++;
        else if (para.type === 'modified') modified++;
      }

      for (const table of section.tables || []) {
        if (table.type === 'added') added++;
        else if (table.type === 'deleted') deleted++;
        else if (table.type === 'modified') modified++;
      }

      const totalChangeCount = added + deleted + modified;

      if (totalChangeCount > 0) {
        sectionChanges.set(section.sectionTitle, {
          sectionName: section.sectionTitle,
          totalChangeCount,
          changeBreakdown: { added, deleted, modified },
        });
      }

      // 递归计算子章节
      for (const subsection of section.subsections || []) {
        countSectionChanges(subsection);
      }
    };

    for (const section of diffResult.sections) {
      countSectionChanges(section);
    }

    // 排序并取前N个
    return Array.from(sectionChanges.values())
      .sort((a, b) => b.totalChangeCount - a.totalChangeCount)
      .slice(0, topCount);
  }

  /**
   * 提取关键数字变化
   */
  private extractKeyNumberChanges(
    diffResult: DiffResult,
    maxCount: number
  ): KeyNumberChange[] {
    const keyChanges: KeyNumberChange[] = [];
    const numberPattern = /\d+(?:\.\d+)?/g;

    const extractFromSection = (section: any, sectionPath: string) => {
      // 从段落中提取
      for (const para of section.paragraphs || []) {
        if (para.type === 'modified' && para.before && para.after) {
          const beforeNumbers = para.before.match(numberPattern) || [];
          const afterNumbers = para.after.match(numberPattern) || [];

          for (let i = 0; i < Math.min(beforeNumbers.length, afterNumbers.length); i++) {
            if (beforeNumbers[i] !== afterNumbers[i]) {
              const oldValue = parseFloat(beforeNumbers[i]);
              const newValue = parseFloat(afterNumbers[i]);
              const changeType = this.determineChangeType(oldValue, newValue);

              keyChanges.push({
                location: `${sectionPath} - 段落`,
                oldValue: beforeNumbers[i],
                newValue: afterNumbers[i],
                changeType,
              });
            }
          }
        }
      }

      // 从表格中提取
      for (const table of section.tables || []) {
        if (table.type === 'modified') {
          for (const cellChange of table.cellChanges || []) {
            if (cellChange.type === 'modified' && cellChange.before && cellChange.after) {
              const beforeNumbers = cellChange.before.match(numberPattern) || [];
              const afterNumbers = cellChange.after.match(numberPattern) || [];

              for (let i = 0; i < Math.min(beforeNumbers.length, afterNumbers.length); i++) {
                if (beforeNumbers[i] !== afterNumbers[i]) {
                  const oldValue = parseFloat(beforeNumbers[i]);
                  const newValue = parseFloat(afterNumbers[i]);
                  const changeType = this.determineChangeType(oldValue, newValue);

                  keyChanges.push({
                    location: `${sectionPath} - 表格`,
                    oldValue: beforeNumbers[i],
                    newValue: afterNumbers[i],
                    changeType,
                  });
                }
              }
            }
          }
        }
      }

      // 递归处理子章节
      for (const subsection of section.subsections || []) {
        extractFromSection(subsection, `${sectionPath}/${subsection.sectionTitle}`);
      }
    };

    for (const section of diffResult.sections) {
      extractFromSection(section, section.sectionTitle);
    }

    // 去重并排序
    const uniqueChanges = Array.from(
      new Map(keyChanges.map((c) => [JSON.stringify(c), c])).values()
    );

    return uniqueChanges.slice(0, maxCount);
  }

  /**
   * 确定变化类型
   */
  private determineChangeType(oldValue: number, newValue: number): ChangeType {
    if (newValue > oldValue) {
      return 'increase';
    } else if (newValue < oldValue) {
      return 'decrease';
    } else {
      return 'change';
    }
  }

  /**
   * 生成总体评估
   */
  private generateAssessment(statistics: DiffStatistics): string {
    const totalChanges =
      statistics.addedParagraphs +
      statistics.deletedParagraphs +
      statistics.modifiedParagraphs +
      statistics.addedTables +
      statistics.deletedTables +
      statistics.modifiedTables;

    if (totalChanges === 0) {
      return '两份文档基本一致';
    }

    if (totalChanges <= 5) {
      return '仅有轻微差异';
    }

    if (totalChanges <= 20) {
      return '存在中等程度的差异，主要体现在内容更新和表格修改';
    }

    return '存在较大差异，建议逐章节仔细审查';
  }
}

export default new SummaryService();
