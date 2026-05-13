import express from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { LlmProviderError } from '../services/LlmProvider';
import { createLlmProvider } from '../services/LlmProviderFactory';
import { resolveParseUploadModelOptions, resolveUnifiedLlmConfig } from '../utils/aiEnv';

const router = express.Router();

interface GenerateConfig {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  responseSchema?: unknown;
  thinkingBudget?: number;
  [key: string]: unknown;
}

interface GenerateRequest {
  model?: string;
  prompt: string;
  systemInstruction?: string;
  config?: GenerateConfig;
}

function stripJsonFences(text: string): string {
  return text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
}

function normalizeModelSelection(modelInput?: string): { providerName: string; modelName: string } {
  const config = resolveUnifiedLlmConfig({
    model: modelInput,
    providerEnvKeys: ['GOV_INSIGHT_REPORT_PROVIDER', 'LLM_REPORT_PROVIDER', 'LLM_PROVIDER'],
    modelEnvKeys: ['GOV_INSIGHT_REPORT_MODEL', 'LLM_REPORT_MODEL', 'OPENAI_MODEL', 'LLM_MODEL'],
  });
  return { providerName: config.provider, modelName: config.model };
}

function withThinkingInstruction(systemInstruction: string | undefined, config?: GenerateConfig): string | undefined {
  const budget = Number(config?.thinkingBudget || 0);
  if (!Number.isFinite(budget) || budget <= 0) {
    return systemInstruction;
  }

  const thinkingInstruction = [
    `思维链模式已开启，推理预算为 ${Math.floor(budget)}。`,
    '请先进行充分的内部推理再输出结论。',
    '不要输出你的推理过程，只输出最终结果。',
  ].join('');

  return [systemInstruction, thinkingInstruction].filter(Boolean).join('\n\n');
}

router.get('/config', authMiddleware, async (_req: AuthRequest, res) => {
  const uploadParse = resolveParseUploadModelOptions();
  return res.json({ uploadParse });
});

router.post('/generate-report', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { model, prompt, systemInstruction, config } = req.body as GenerateRequest;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const { providerName, modelName } = normalizeModelSelection(model);
    const finalSystemInstruction = withThinkingInstruction(systemInstruction, config);

    console.log(`[AI] Generating report with ${providerName} / ${modelName}`);

    const llm = createLlmProvider(providerName, modelName);
    if (!llm.generate) {
      return res.status(500).json({ error: `Provider ${providerName} does not support generation` });
    }

    const result = await llm.generate(prompt, finalSystemInstruction, config || {});
    const text = String(result?.text || '');

    if (!text.trim()) {
      return res.status(502).json({ error: 'empty_model_response' });
    }

    try {
      const parsed = JSON.parse(stripJsonFences(text));
      return res.json(parsed);
    } catch {
      return res.status(502).json({
        error: 'json_parse_failed',
        text,
      });
    }
  } catch (error: unknown) {
    console.error('[AI] Generation error:', error);

    if (error instanceof LlmProviderError) {
      const status = error.code?.includes('timeout') ? 408 : 500;
      return res.status(status).json({
        error: error.message,
        code: error.code,
      });
    }

    const err = error as Error;
    return res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

export default router;
