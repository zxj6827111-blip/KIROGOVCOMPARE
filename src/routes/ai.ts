import express from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { LlmProviderError } from '../services/LlmProvider';
import { createLlmProvider } from '../services/LlmProviderFactory';

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
  model: string;
  prompt: string;
  systemInstruction?: string;
  config?: GenerateConfig;
}

function stripJsonFences(text: string): string {
  return text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
}

function normalizeModelSelection(modelInput: string): { providerName: string; modelName: string } {
  const model = String(modelInput || '').trim();
  const lower = model.toLowerCase();

  if (lower === 'deepseek-v3' || lower === 'deepseek-v3.2') {
    return { providerName: 'nvidia', modelName: 'deepseek-ai/deepseek-v3.2' };
  }

  if (lower === 'kimi2.5' || lower === 'kimi-k2.5') {
    return { providerName: 'nvidia', modelName: 'moonshotai/kimi-k2.5' };
  }

  if (lower.startsWith('nvidia/')) {
    return { providerName: 'nvidia', modelName: model.slice('nvidia/'.length) };
  }

  if (lower.startsWith('deepseek/')) {
    return { providerName: 'nvidia', modelName: model.slice('deepseek/'.length) };
  }

  if (lower.startsWith('kimi/')) {
    return { providerName: 'nvidia', modelName: model.slice('kimi/'.length) };
  }

  if (lower.startsWith('gemini/')) {
    return { providerName: 'gemini', modelName: model.slice('gemini/'.length) };
  }

  if (lower === 'gemini-3-flash-preview') {
    return { providerName: 'gemini', modelName: 'gemini-2.5-flash' };
  }

  if (lower === 'gemini-3-pro-preview') {
    return { providerName: 'gemini', modelName: 'gemini-2.5-pro' };
  }

  if (lower.includes('gemini')) {
    return { providerName: 'gemini', modelName: model };
  }

  if (lower.startsWith('zhipu/')) {
    return { providerName: 'zhipu', modelName: model.slice('zhipu/'.length) };
  }

  if (lower.includes('glm')) {
    return { providerName: 'zhipu', modelName: model };
  }

  return {
    providerName: (process.env.LLM_PROVIDER || 'gemini').toLowerCase(),
    modelName: model,
  };
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

router.post('/generate-report', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { model, prompt, systemInstruction, config } = req.body as GenerateRequest;

    if (!model || typeof model !== 'string') {
      return res.status(400).json({ error: 'Model is required' });
    }

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
