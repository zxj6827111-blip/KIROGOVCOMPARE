import axios from 'axios';
import { DiffSummary, SuspiciousPoint } from '../types/models';
import { AISuggestion } from '../models/AISuggestion';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';

export interface AISuggestionOptions {
  topSectionsCount?: number;
  maxCharacters?: number;
  forceRegenerate?: boolean;
}

export class AISuggestionService {
  private openaiApiKey = process.env.OPENAI_API_KEY;
  private aiConfigVersion = parseInt(process.env.AI_CONFIG_VERSION || '1');

  /**
   * 生成AI建议
   */
  async generateSuggestion(
    compareTaskId: string,
    diffSummary: DiffSummary,
    options: AISuggestionOptions = {}
  ): Promise<AISuggestion | null> {
    try {
      // 检查缓存
      if (!options.forceRegenerate) {
        const cached = await this.getCachedSuggestion(compareTaskId);
        if (cached) {
          return cached;
        }
      }

      // 创建建议记录
      const suggestionId = `sugg_${uuidv4()}`;
      const suggestion = new AISuggestion({
        suggestionId,
        compareTaskId,
        aiConfigVersion: this.aiConfigVersion,
        status: 'queued',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 保存到数据库
      await this.saveSuggestionToDatabase(suggestion);

      // 生成建议内容
      const content = await this.generateSuggestionContent(diffSummary, options);

      // 更新建议
      suggestion.status = 'succeeded';
      suggestion.interpretation = content.interpretation;
      suggestion.suspiciousPoints = content.suspiciousPoints;
      suggestion.improvementSuggestions = content.improvementSuggestions;
      suggestion.completedAt = new Date();
      suggestion.updatedAt = new Date();

      // 更新数据库
      await this.updateSuggestionInDatabase(suggestion);

      return suggestion;
    } catch (error) {
      console.error('生成AI建议失败:', error);
      return null;
    }
  }

  /**
   * 获取缓存的建议
   */
  private async getCachedSuggestion(compareTaskId: string): Promise<AISuggestion | null> {
    try {
      const result = await pool.query(
        `
        SELECT * FROM ai_suggestions
        WHERE compare_task_id = $1 AND ai_config_version = $2 AND status = 'succeeded'
        ORDER BY created_at DESC LIMIT 1
        `,
        [compareTaskId, this.aiConfigVersion]
      );

      if (result.rows.length > 0) {
        return this.rowToSuggestion(result.rows[0]);
      }
    } catch (error) {
      console.error('查询缓存建议失败:', error);
    }
    return null;
  }

  /**
   * 生成建议内容
   */
  private async generateSuggestionContent(
    diffSummary: DiffSummary,
    options: AISuggestionOptions
  ): Promise<{
    interpretation: string;
    suspiciousPoints: SuspiciousPoint[];
    improvementSuggestions: string[];
  }> {
    // 如果没有配置OpenAI API，返回默认建议
    if (!this.openaiApiKey) {
      return this.generateDefaultSuggestion(diffSummary);
    }

    try {
      // 准备输入
      const input = this.prepareSuggestionInput(diffSummary, options);

      // 调用OpenAI API
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: `你是一个政府文件审查专家。分析以下差异摘要，提供：
1. 差异点解读（简洁说明主要变化）
2. 可疑点（需要人工复核的地方，使用保守措辞）
3. 规范性改进建议

请以JSON格式返回，包含以下字段：
{
  "interpretation": "...",
  "suspiciousPoints": [{"location": "...", "description": "...", "riskLevel": "low|medium|high", "recommendation": "..."}],
  "improvementSuggestions": ["...", "..."]
}`,
            },
            {
              role: 'user',
              content: input,
            },
          ],
          temperature: 0.7,
          max_tokens: 1000,
        },
        {
          headers: {
            Authorization: `Bearer ${this.openaiApiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const content = response.data.choices[0].message.content;
      const parsed = JSON.parse(content);

      return {
        interpretation: parsed.interpretation || '',
        suspiciousPoints: parsed.suspiciousPoints || [],
        improvementSuggestions: parsed.improvementSuggestions || [],
      };
    } catch (error) {
      console.error('调用OpenAI API失败:', error);
      return this.generateDefaultSuggestion(diffSummary);
    }
  }

  /**
   * 生成默认建议
   */
  private generateDefaultSuggestion(diffSummary: DiffSummary): {
    interpretation: string;
    suspiciousPoints: SuspiciousPoint[];
    improvementSuggestions: string[];
  } {
    const stats = diffSummary.statistics;
    const totalChanges =
      stats.addedParagraphs +
      stats.deletedParagraphs +
      stats.modifiedParagraphs +
      stats.addedTables +
      stats.deletedTables +
      stats.modifiedTables;

    const interpretation = `本次对比发现共${totalChanges}处变化，其中新增${stats.addedParagraphs}段落、删除${stats.deletedParagraphs}段落、修改${stats.modifiedParagraphs}段落。表格方面新增${stats.addedTables}个、删除${stats.deletedTables}个、修改${stats.modifiedTables}个。`;

    const suspiciousPoints: SuspiciousPoint[] = [];

    if (stats.modifiedParagraphs > 10) {
      suspiciousPoints.push({
        location: '正文内容',
        description: '修改段落数量较多，建议逐一审查',
        riskLevel: 'medium',
        recommendation: '建议人工逐段审查修改内容，确保准确性',
      });
    }

    if (stats.modifiedTables > 5) {
      suspiciousPoints.push({
        location: '表格数据',
        description: '表格修改较多，可能涉及数据变化',
        riskLevel: 'medium',
        recommendation: '建议重点审查表格数据的准确性和一致性',
      });
    }

    if (diffSummary.keyNumberChanges.length > 0) {
      const largeChanges = diffSummary.keyNumberChanges.filter((c) => {
        const oldVal = parseFloat(c.oldValue);
        const newVal = parseFloat(c.newValue);
        const changePercent = Math.abs((newVal - oldVal) / oldVal) * 100;
        return changePercent > 20;
      });

      if (largeChanges.length > 0) {
        suspiciousPoints.push({
          location: '关键数字',
          description: `发现${largeChanges.length}处数字变化超过20%`,
          riskLevel: 'high',
          recommendation: '建议重点审查这些数字变化的合理性',
        });
      }
    }

    const improvementSuggestions = [
      '建议按照统一的格式规范编写报告',
      '确保所有数据来源清晰可追溯',
      '建议对重要数据进行交叉验证',
      '建议保持报告结构的一致性',
    ];

    return {
      interpretation,
      suspiciousPoints,
      improvementSuggestions,
    };
  }

  /**
   * 准备建议输入
   */
  private prepareSuggestionInput(
    diffSummary: DiffSummary,
    options: AISuggestionOptions
  ): string {
    const topSectionsCount = options.topSectionsCount || 5;
    const maxCharacters = options.maxCharacters || 2000;

    let input = '差异摘要：\n';
    input += `总体评估：${diffSummary.overallAssessment}\n\n`;

    input += '统计数据：\n';
    const stats = diffSummary.statistics;
    input += `新增段落: ${stats.addedParagraphs}, 删除段落: ${stats.deletedParagraphs}, 修改段落: ${stats.modifiedParagraphs}\n`;
    input += `新增表格: ${stats.addedTables}, 删除表格: ${stats.deletedTables}, 修改表格: ${stats.modifiedTables}\n\n`;

    input += '变化最多的章节：\n';
    for (const section of diffSummary.topChangedSections.slice(0, topSectionsCount)) {
      input += `- ${section.sectionName}: ${section.totalChangeCount}处变化\n`;
    }

    if (diffSummary.keyNumberChanges.length > 0) {
      input += '\n关键数字变化：\n';
      for (const change of diffSummary.keyNumberChanges.slice(0, 5)) {
        input += `- ${change.location}: ${change.oldValue} → ${change.newValue}\n`;
      }
    }

    // 截断到最大字符数
    if (input.length > maxCharacters) {
      input = input.substring(0, maxCharacters) + '...';
    }

    return input;
  }

  /**
   * 保存建议到数据库
   */
  private async saveSuggestionToDatabase(suggestion: AISuggestion): Promise<void> {
    const query = `
      INSERT INTO ai_suggestions (
        suggestion_id, compare_task_id, ai_config_version, status,
        interpretation, suspicious_points, improvement_suggestions,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    await pool.query(query, [
      suggestion.suggestionId,
      suggestion.compareTaskId,
      suggestion.aiConfigVersion,
      suggestion.status,
      suggestion.interpretation,
      JSON.stringify(suggestion.suspiciousPoints),
      suggestion.improvementSuggestions,
      suggestion.createdAt,
      suggestion.updatedAt,
    ]);
  }

  /**
   * 更新建议到数据库
   */
  private async updateSuggestionInDatabase(suggestion: AISuggestion): Promise<void> {
    const query = `
      UPDATE ai_suggestions
      SET status = $1, interpretation = $2, suspicious_points = $3,
          improvement_suggestions = $4, completed_at = $5, updated_at = $6
      WHERE suggestion_id = $7
    `;

    await pool.query(query, [
      suggestion.status,
      suggestion.interpretation,
      JSON.stringify(suggestion.suspiciousPoints),
      suggestion.improvementSuggestions,
      suggestion.completedAt,
      suggestion.updatedAt,
      suggestion.suggestionId,
    ]);
  }

  private rowToSuggestion(row: any): AISuggestion {
    return new AISuggestion({
      suggestionId: row.suggestion_id,
      compareTaskId: row.compare_task_id,
      aiConfigVersion: row.ai_config_version,
      status: row.status,
      interpretation: row.interpretation,
      suspiciousPoints: row.suspicious_points,
      improvementSuggestions: row.improvement_suggestions,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    });
  }
}

export default new AISuggestionService();
