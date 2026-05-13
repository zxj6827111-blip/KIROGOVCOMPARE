import { DiffSummary, SuspiciousPoint } from '../types/models';
import { AISuggestion } from '../models/AISuggestion';
import { uuidv4 } from '../utils/uuid';
import pool from '../config/database';
import { resolveUnifiedLlmConfig } from '../utils/aiEnv';
import { createLlmProvider } from './LlmProviderFactory';
import { parseStructuredJsonFromText } from './LlmCommon';

export interface AISuggestionOptions {
  topSectionsCount?: number;
  maxCharacters?: number;
  forceRegenerate?: boolean;
}

export class AISuggestionService {
  private aiConfigVersion = parseInt(process.env.AI_CONFIG_VERSION || '1', 10);
  private temperature = Number(process.env.AI_SUGGESTION_TEMPERATURE || 0.7);
  private maxOutputTokens = Number(process.env.AI_SUGGESTION_MAX_TOKENS || 1000);

  async generateSuggestion(
    compareTaskId: string,
    diffSummary: DiffSummary,
    options: AISuggestionOptions = {}
  ): Promise<AISuggestion | null> {
    try {
      if (!options.forceRegenerate) {
        const cached = await this.getCachedSuggestion(compareTaskId);
        if (cached) {
          return cached;
        }
      }

      const suggestionId = `sugg_${uuidv4()}`;
      const suggestion = new AISuggestion({
        suggestionId,
        compareTaskId,
        aiConfigVersion: this.aiConfigVersion,
        status: 'queued',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await this.saveSuggestionToDatabase(suggestion);

      const content = await this.generateSuggestionContent(diffSummary, options);

      suggestion.status = 'succeeded';
      suggestion.interpretation = content.interpretation;
      suggestion.suspiciousPoints = content.suspiciousPoints;
      suggestion.improvementSuggestions = content.improvementSuggestions;
      suggestion.completedAt = new Date();
      suggestion.updatedAt = new Date();

      await this.updateSuggestionInDatabase(suggestion);

      return suggestion;
    } catch (error) {
      console.error('[AISuggestionService] Failed to generate suggestion:', error);
      return null;
    }
  }

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
      console.error('[AISuggestionService] Failed to read cached suggestion:', error);
    }
    return null;
  }

  private async generateSuggestionContent(
    diffSummary: DiffSummary,
    options: AISuggestionOptions
  ): Promise<{
    interpretation: string;
    suspiciousPoints: SuspiciousPoint[];
    improvementSuggestions: string[];
  }> {
    try {
      const input = this.prepareSuggestionInput(diffSummary, options);
      const llmConfig = resolveUnifiedLlmConfig({
        model: process.env.AI_SUGGESTION_MODEL,
        providerEnvKeys: ['AI_SUGGESTION_PROVIDER', 'LLM_PROVIDER'],
        modelEnvKeys: ['AI_SUGGESTION_MODEL', 'OPENAI_MODEL', 'LLM_MODEL'],
      });
      const llm = createLlmProvider(llmConfig.provider, llmConfig.model);
      if (!llm.generate) {
        return this.generateDefaultSuggestion(diffSummary);
      }

      const result = await llm.generate(input, this.buildSuggestionSystemInstruction(), {
        temperature: Number.isFinite(this.temperature) ? this.temperature : 0.7,
        maxOutputTokens: Number.isFinite(this.maxOutputTokens) ? this.maxOutputTokens : 1000,
        responseMimeType: 'application/json',
        apiMode: process.env.AI_SUGGESTION_OPENAI_API_MODE || process.env.OPENAI_API_MODE,
        responseSchemaName: 'ai_suggestion',
        responseSchemaDescription: 'Structured AI suggestions for report comparison differences.',
        responseSchema: this.buildSuggestionResponseSchema(),
        responseStrict: false,
      });

      const parsed = parseStructuredJsonFromText<any>(String(result?.text || ''));
      return {
        interpretation: String(parsed.interpretation || ''),
        suspiciousPoints: Array.isArray(parsed.suspiciousPoints) ? parsed.suspiciousPoints : [],
        improvementSuggestions: Array.isArray(parsed.improvementSuggestions) ? parsed.improvementSuggestions : [],
      };
    } catch (error) {
      console.error('[AISuggestionService] Model suggestion failed:', error);
      return this.generateDefaultSuggestion(diffSummary);
    }
  }

  private buildSuggestionSystemInstruction(): string {
    return [
      '你是政府信息公开年度报告差异审查专家。',
      '请基于差异摘要，输出 JSON，不要输出 Markdown 或额外解释。',
      '字段包括 interpretation、suspiciousPoints、improvementSuggestions。',
      'suspiciousPoints 每项包含 location、description、riskLevel、recommendation。',
      'riskLevel 只能使用 low、medium、high。',
    ].join('\n');
  }

  private buildSuggestionResponseSchema(): Record<string, unknown> {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['interpretation', 'suspiciousPoints', 'improvementSuggestions'],
      properties: {
        interpretation: { type: 'string' },
        suspiciousPoints: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['location', 'description', 'riskLevel', 'recommendation'],
            properties: {
              location: { type: 'string' },
              description: { type: 'string' },
              riskLevel: { type: 'string' },
              recommendation: { type: 'string' },
            },
          },
        },
        improvementSuggestions: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    };
  }

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

    const interpretation = `本次对比发现共 ${totalChanges} 处变化，其中新增 ${stats.addedParagraphs} 个段落，删除 ${stats.deletedParagraphs} 个段落，修改 ${stats.modifiedParagraphs} 个段落；表格新增 ${stats.addedTables} 个，删除 ${stats.deletedTables} 个，修改 ${stats.modifiedTables} 个。`;

    const suspiciousPoints: SuspiciousPoint[] = [];

    if (stats.modifiedParagraphs > 10) {
      suspiciousPoints.push({
        location: '正文内容',
        description: '修改段落数量较多，建议逐项复核。',
        riskLevel: 'medium',
        recommendation: '人工逐段审查修改内容，确认表述、口径和数据来源一致。',
      });
    }

    if (stats.modifiedTables > 5) {
      suspiciousPoints.push({
        location: '表格数据',
        description: '表格修改较多，可能涉及关键统计口径变化。',
        riskLevel: 'medium',
        recommendation: '重点审查表格数据准确性，并与原始年报数据交叉核验。',
      });
    }

    if (diffSummary.keyNumberChanges.length > 0) {
      const largeChanges = diffSummary.keyNumberChanges.filter((change) => {
        const oldValue = parseFloat(change.oldValue);
        const newValue = parseFloat(change.newValue);
        if (!Number.isFinite(oldValue) || oldValue === 0 || !Number.isFinite(newValue)) {
          return false;
        }
        return Math.abs((newValue - oldValue) / oldValue) * 100 > 20;
      });

      if (largeChanges.length > 0) {
        suspiciousPoints.push({
          location: '关键数字',
          description: `发现 ${largeChanges.length} 处数字变化超过 20%。`,
          riskLevel: 'high',
          recommendation: '重点审查这些数字变化的来源、统计口径和合理性。',
        });
      }
    }

    const improvementSuggestions = [
      '建议按照统一格式规范编写报告。',
      '确保所有数据来源清晰可追溯。',
      '对重要数据进行交叉验证。',
      '保持报告结构和统计口径一致。',
    ];

    return {
      interpretation,
      suspiciousPoints,
      improvementSuggestions,
    };
  }

  private prepareSuggestionInput(diffSummary: DiffSummary, options: AISuggestionOptions): string {
    const topSectionsCount = options.topSectionsCount || 5;
    const maxCharacters = options.maxCharacters || 2000;

    let input = '差异摘要：\n';
    input += `总体评估：${diffSummary.overallAssessment}\n\n`;

    const stats = diffSummary.statistics;
    input += '统计数据：\n';
    input += `新增段落: ${stats.addedParagraphs}, 删除段落: ${stats.deletedParagraphs}, 修改段落: ${stats.modifiedParagraphs}\n`;
    input += `新增表格: ${stats.addedTables}, 删除表格: ${stats.deletedTables}, 修改表格: ${stats.modifiedTables}\n\n`;

    input += '变化最多的章节：\n';
    for (const section of diffSummary.topChangedSections.slice(0, topSectionsCount)) {
      input += `- ${section.sectionName}: ${section.totalChangeCount} 处变化\n`;
    }

    if (diffSummary.keyNumberChanges.length > 0) {
      input += '\n关键数字变化：\n';
      for (const change of diffSummary.keyNumberChanges.slice(0, 5)) {
        input += `- ${change.location}: ${change.oldValue} -> ${change.newValue}\n`;
      }
    }

    if (input.length > maxCharacters) {
      input = `${input.substring(0, maxCharacters)}...`;
    }

    return input;
  }

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
