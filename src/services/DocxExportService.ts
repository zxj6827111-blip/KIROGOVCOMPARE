import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, AlignmentType, BorderStyle, WidthType, convertInchesToTwip } from 'docx';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DiffResult, DiffSummary, AISuggestion } from '../types/models';

export interface DocxExportOptions {
  title?: string;
  includeAiSuggestion?: boolean;
}

export class DocxExportService {
  /**
   * 生成对比报告DOCX
   */
  async generateDiffReport(
    diffResult: DiffResult,
    summary: DiffSummary,
    options: DocxExportOptions = {}
  ): Promise<string> {
    const title = options.title || '政府信息公开年度报告差异对比报告';
    const sections: Paragraph[] = [];

    // 添加标题
    sections.push(
      new Paragraph({
        text: title,
        heading: 'Heading1',
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );

    // 添加摘要部分
    sections.push(...this.generateSummarySection(summary));

    // 添加详细对比部分
    sections.push(...this.generateDetailedDiffSection(diffResult));

    const doc = new Document({
      sections: [
        {
          children: sections,
        },
      ],
    });

    return this.saveDocument(doc);
  }

  /**
   * 生成包含AI建议的报告DOCX
   */
  async generateDiffReportWithAI(
    diffResult: DiffResult,
    summary: DiffSummary,
    aiSuggestion: AISuggestion,
    options: DocxExportOptions = {}
  ): Promise<string> {
    const title = options.title || '政府信息公开年度报告差异对比报告（含AI建议）';
    const sections: Paragraph[] = [];

    // 添加标题
    sections.push(
      new Paragraph({
        text: title,
        heading: 'Heading1',
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );

    // 添加摘要部分
    sections.push(...this.generateSummarySection(summary));

    // 添加AI建议部分
    sections.push(...this.generateAISuggestionSection(aiSuggestion));

    // 添加详细对比部分
    sections.push(...this.generateDetailedDiffSection(diffResult));

    const doc = new Document({
      sections: [
        {
          children: sections,
        },
      ],
    });

    return this.saveDocument(doc);
  }

  /**
   * 生成摘要部分
   */
  private generateSummarySection(summary: DiffSummary): Paragraph[] {
    const sections: Paragraph[] = [];

    // 总体评估
    sections.push(
      new Paragraph({
        text: '总体评估',
        heading: 'Heading2',
        spacing: { before: 200, after: 200 },
      })
    );

    sections.push(
      new Paragraph({
        text: summary.overallAssessment,
        spacing: { after: 200 },
      })
    );

    // 统计数据
    sections.push(
      new Paragraph({
        text: '差异统计',
        heading: 'Heading2',
        spacing: { before: 200, after: 200 },
      })
    );

    const stats = summary.statistics;
    sections.push(
      new Paragraph({
        text: `新增段落: ${stats.addedParagraphs} | 删除段落: ${stats.deletedParagraphs} | 修改段落: ${stats.modifiedParagraphs}`,
        spacing: { after: 100 },
      })
    );

    sections.push(
      new Paragraph({
        text: `新增表格: ${stats.addedTables} | 删除表格: ${stats.deletedTables} | 修改表格: ${stats.modifiedTables}`,
        spacing: { after: 200 },
      })
    );

    // 变化最多的章节
    if (summary.topChangedSections.length > 0) {
      sections.push(
        new Paragraph({
          text: '变化最多的章节',
          heading: 'Heading2',
          spacing: { before: 200, after: 200 },
        })
      );

      for (const section of summary.topChangedSections) {
        sections.push(
          new Paragraph({
            text: `${section.sectionName} (变更数: ${section.totalChangeCount})`,
            spacing: { after: 100 },
          })
        );
      }

      sections.push(new Paragraph({ text: '', spacing: { after: 200 } }));
    }

    // 关键数字变化
    if (summary.keyNumberChanges.length > 0) {
      sections.push(
        new Paragraph({
          text: '关键数字变化',
          heading: 'Heading2',
          spacing: { before: 200, after: 200 },
        })
      );

      for (const change of summary.keyNumberChanges) {
        const changeText =
          change.changeType === 'increase'
            ? '↑'
            : change.changeType === 'decrease'
              ? '↓'
              : '→';
        sections.push(
          new Paragraph({
            text: `${change.location}: ${change.oldValue} ${changeText} ${change.newValue}`,
            spacing: { after: 100 },
          })
        );
      }

      sections.push(new Paragraph({ text: '', spacing: { after: 200 } }));
    }

    return sections;
  }

  /**
   * 生成AI建议部分
   */
  private generateAISuggestionSection(aiSuggestion: AISuggestion): Paragraph[] {
    const sections: Paragraph[] = [];

    sections.push(
      new Paragraph({
        text: 'AI建议',
        heading: 'Heading2',
        spacing: { before: 200, after: 200 },
      })
    );

    // 差异点解读
    if (aiSuggestion.interpretation) {
      sections.push(
        new Paragraph({
          text: '差异点解读',
          heading: 'Heading3',
          spacing: { before: 100, after: 100 },
        })
      );

      sections.push(
        new Paragraph({
          text: aiSuggestion.interpretation,
          spacing: { after: 200 },
        })
      );
    }

    // 可疑点
    if (aiSuggestion.suspiciousPoints && aiSuggestion.suspiciousPoints.length > 0) {
      sections.push(
        new Paragraph({
          text: '需要人工复核的可疑点',
          heading: 'Heading3',
          spacing: { before: 100, after: 100 },
        })
      );

      for (const point of aiSuggestion.suspiciousPoints) {
        const riskLabel =
          point.riskLevel === 'high'
            ? '[高风险]'
            : point.riskLevel === 'medium'
              ? '[中风险]'
              : '[低风险]';

        sections.push(
          new Paragraph({
            text: `${riskLabel} ${point.location}`,
            spacing: { after: 50 },
          })
        );

        sections.push(
          new Paragraph({
            text: `描述: ${point.description}`,
            spacing: { after: 50 },
          })
        );

        sections.push(
          new Paragraph({
            text: `建议: ${point.recommendation}`,
            spacing: { after: 100 },
          })
        );
      }

      sections.push(new Paragraph({ text: '', spacing: { after: 200 } }));
    }

    // 改进建议
    if (aiSuggestion.improvementSuggestions && aiSuggestion.improvementSuggestions.length > 0) {
      sections.push(
        new Paragraph({
          text: '规范性改进建议',
          heading: 'Heading3',
          spacing: { before: 100, after: 100 },
        })
      );

      for (const suggestion of aiSuggestion.improvementSuggestions) {
        sections.push(
          new Paragraph({
            text: `• ${suggestion}`,
            spacing: { after: 50 },
          })
        );
      }

      sections.push(new Paragraph({ text: '', spacing: { after: 200 } }));
    }

    return sections;
  }

  /**
   * 生成详细对比部分
   */
  private generateDetailedDiffSection(diffResult: DiffResult): Paragraph[] {
    const sections: Paragraph[] = [];

    sections.push(
      new Paragraph({
        text: '详细对比',
        heading: 'Heading2',
        spacing: { before: 200, after: 200 },
      })
    );

    for (const section of diffResult.sections) {
      sections.push(...this.generateSectionDiff(section));
    }

    return sections;
  }

  /**
   * 生成章节差异
   */
  private generateSectionDiff(section: any): Paragraph[] {
    const sections: Paragraph[] = [];

    // 章节标题
    sections.push(
      new Paragraph({
        text: section.sectionTitle,
        heading: section.level === 1 ? 'Heading2' : 'Heading3',
        spacing: { before: 100, after: 100 },
      })
    );

    // 段落差异
    for (const para of section.paragraphs || []) {
      if (para.type === 'added') {
        sections.push(
          new Paragraph({
            text: `[新增] ${para.after}`,
            spacing: { after: 50 },
            border: {
              bottom: {
                color: '00B050',
                space: 1,
                style: BorderStyle.SINGLE,
                size: 6,
              },
            },
          })
        );
      } else if (para.type === 'deleted') {
        sections.push(
          new Paragraph({
            text: `[删除] ${para.before}`,
            spacing: { after: 50 },
            border: {
              bottom: {
                color: 'FF0000',
                space: 1,
                style: BorderStyle.SINGLE,
                size: 6,
              },
            },
          })
        );
      } else if (para.type === 'modified') {
        sections.push(
          new Paragraph({
            text: `[修改前] ${para.before}`,
            spacing: { after: 50 },
          })
        );

        sections.push(
          new Paragraph({
            text: `[修改后] ${para.after}`,
            spacing: { after: 100 },
          })
        );
      }
    }

    // 表格差异
    for (const table of section.tables || []) {
      if (table.type === 'added') {
        sections.push(
          new Paragraph({
            text: `[新增表格] ${table.tableId}`,
            spacing: { after: 100 },
          })
        );
      } else if (table.type === 'deleted') {
        sections.push(
          new Paragraph({
            text: `[删除表格] ${table.tableId}`,
            spacing: { after: 100 },
          })
        );
      } else if (table.type === 'modified' && table.cellChanges.length > 0) {
        sections.push(
          new Paragraph({
            text: `[表格修改] ${table.tableId}`,
            spacing: { after: 50 },
          })
        );

        for (const change of table.cellChanges) {
          const changeText =
            change.type === 'added'
              ? `[新增] 行${change.rowIndex}列${change.colIndex}: ${change.after}`
              : change.type === 'deleted'
                ? `[删除] 行${change.rowIndex}列${change.colIndex}: ${change.before}`
                : `[修改] 行${change.rowIndex}列${change.colIndex}: ${change.before} → ${change.after}`;

          sections.push(
            new Paragraph({
              text: changeText,
              spacing: { after: 50 },
            })
          );
        }

        sections.push(new Paragraph({ text: '', spacing: { after: 100 } }));
      }
    }

    // 递归处理子章节
    for (const subsection of section.subsections || []) {
      sections.push(...this.generateSectionDiff(subsection));
    }

    return sections;
  }

  /**
   * 保存文档到文件
   */
  private async saveDocument(doc: Document): Promise<string> {
    const fileName = `diff_report_${uuidv4()}.docx`;
    const outputDir = path.join(process.cwd(), 'exports');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filePath = path.join(outputDir, fileName);

    return new Promise((resolve, reject) => {
      Packer.toBuffer(doc).then((buffer) => {
        fs.writeFile(filePath, buffer, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(filePath);
          }
        });
      });
    });
  }
}

export default new DocxExportService();
