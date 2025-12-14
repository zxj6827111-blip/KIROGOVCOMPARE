import { StructuredDocument, Section, Paragraph, Table, TableRow, TableCell } from '../types/models';
import PdfParseService, { ParseResult } from './PdfParseService';

export interface StructuringResult {
  success: boolean;
  document?: StructuredDocument;
  error?: string;
}

export class StructuringService {
  /**
   * 将 PDF 解析结果整理成结构化数据模型
   */
  async structureDocument(parseResult: ParseResult): Promise<StructuringResult> {
    try {
      if (!parseResult.success || !parseResult.document) {
        return {
          success: false,
          error: '解析失败，无法进行结构化',
        };
      }

      const document = parseResult.document;

      // 增强章节结构
      const enhancedSections = this.enhanceSections(document.sections);

      // 构建最终的结构化文档
      const structuredDocument: StructuredDocument = {
        documentId: document.documentId,
        assetId: document.assetId,
        title: document.title,
        sections: enhancedSections,
        metadata: document.metadata,
      };

      return {
        success: true,
        document: structuredDocument,
      };
    } catch (error) {
      return {
        success: false,
        error: `结构化失败: ${error}`,
      };
    }
  }

  /**
   * 增强章节结构，确保层级正确
   */
  private enhanceSections(sections: Section[]): Section[] {
    return sections.map((section) => this.enhanceSection(section));
  }

  /**
   * 增强单个章节
   */
  private enhanceSection(section: Section): Section {
    return {
      ...section,
      content: section.content || [],
      tables: section.tables || [],
      subsections: (section.subsections || []).map((sub) => this.enhanceSection(sub)),
    };
  }

  /**
   * 获取特定章节的表格
   */
  getTablesByChapter(document: StructuredDocument, chapterNumber: string): Table[] {
    const tables: Table[] = [];

    const findTables = (sections: Section[]) => {
      for (const section of sections) {
        if (section.title.includes(chapterNumber)) {
          tables.push(...section.tables);
        }
        if (section.subsections) {
          findTables(section.subsections);
        }
      }
    };

    findTables(document.sections);
    return tables;
  }

  /**
   * 获取所有表格
   */
  getAllTables(document: StructuredDocument): Table[] {
    const tables: Table[] = [];

    const collectTables = (sections: Section[]) => {
      for (const section of sections) {
        tables.push(...section.tables);
        if (section.subsections) {
          collectTables(section.subsections);
        }
      }
    };

    collectTables(document.sections);
    return tables;
  }

  /**
   * 获取所有段落
   */
  getAllParagraphs(document: StructuredDocument): Paragraph[] {
    const paragraphs: Paragraph[] = [];

    const collectParagraphs = (sections: Section[]) => {
      for (const section of sections) {
        paragraphs.push(...section.content);
        if (section.subsections) {
          collectParagraphs(section.subsections);
        }
      }
    };

    collectParagraphs(document.sections);
    return paragraphs;
  }

  /**
   * 按章节组织内容
   */
  getContentByChapter(document: StructuredDocument, chapterNumber: string): {
    section?: Section;
    paragraphs: Paragraph[];
    tables: Table[];
  } {
    let targetSection: Section | undefined;

    const findSection = (sections: Section[]): boolean => {
      for (const section of sections) {
        if (section.title.includes(chapterNumber)) {
          targetSection = section;
          return true;
        }
        if (section.subsections && findSection(section.subsections)) {
          return true;
        }
      }
      return false;
    };

    findSection(document.sections);

    return {
      section: targetSection,
      paragraphs: targetSection?.content || [],
      tables: targetSection?.tables || [],
    };
  }

  /**
   * 验证结构化文档的完整性
   */
  validateStructure(document: StructuredDocument): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // 检查基本字段
    if (!document.documentId) {
      issues.push('缺少 documentId');
    }
    if (!document.assetId) {
      issues.push('缺少 assetId');
    }
    if (!document.title) {
      issues.push('缺少 title');
    }
    if (!document.sections || document.sections.length === 0) {
      issues.push('缺少 sections 或 sections 为空');
    }

    // 检查章节结构
    const validateSections = (sections: Section[], level: number = 1) => {
      for (const section of sections) {
        if (!section.id) {
          issues.push(`第 ${level} 级章节缺少 id`);
        }
        if (!section.title) {
          issues.push(`第 ${level} 级章节缺少 title`);
        }
        if (section.level !== level) {
          issues.push(`第 ${level} 级章节的 level 字段不匹配`);
        }

        // 检查表格
        if (section.tables) {
          for (const table of section.tables) {
            if (!table.id) {
              issues.push(`章节 ${section.title} 的表格缺少 id`);
            }
            if (!table.rows) {
              issues.push(`章节 ${section.title} 的表格缺少 rows`);
            }
          }
        }

        // 递归检查子章节
        if (section.subsections) {
          validateSections(section.subsections, level + 1);
        }
      }
    };

    validateSections(document.sections);

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * 生成结构化文档的摘要
   */
  generateSummary(document: StructuredDocument): {
    title: string;
    totalSections: number;
    totalParagraphs: number;
    totalTables: number;
    chapters: Array<{
      number: string;
      title: string;
      paragraphs: number;
      tables: number;
    }>;
  } {
    const tables = this.getAllTables(document);
    const paragraphs = this.getAllParagraphs(document);

    const chapters = document.sections.map((section) => ({
      number: section.title.split('、')[0] || '',
      title: section.title,
      paragraphs: section.content.length,
      tables: section.tables.length,
    }));

    return {
      title: document.title,
      totalSections: document.sections.length,
      totalParagraphs: paragraphs.length,
      totalTables: tables.length,
      chapters,
    };
  }
}

export default new StructuringService();
