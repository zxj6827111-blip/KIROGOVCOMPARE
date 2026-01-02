import { LlmProvider, LlmProviderError } from './LlmProvider';
import { GeminiLlmProvider } from './GeminiLlmProvider';
import { ModelScopeLlmProvider } from './ModelScopeLlmProvider';
import { GlmFlashLlmProvider } from './GlmFlashLlmProvider';
import { StubLlmProvider } from './StubLlmProvider';

export type SupportedLlmProvider = 'stub' | 'gemini' | 'modelscope' | 'glm-flash' | 'glm-4.5-flash';

function resolveProviderName(): SupportedLlmProvider {
  const provider = (process.env.LLM_PROVIDER || 'stub').toLowerCase();
  if (provider === 'gemini') {
    return 'gemini';
  }
  if (provider === 'modelscope') {
    return 'modelscope';
  }
  if (provider === 'glm-flash') {
    return 'glm-flash';
  }
  return 'stub';
}

export function createLlmProvider(providerName?: string, modelName?: string): LlmProvider {
  const provider = providerName ? (providerName.toLowerCase() as SupportedLlmProvider) : resolveProviderName();

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = modelName || process.env.GEMINI_MODEL || process.env.LLM_MODEL || 'gemini-2.5-flash';

    if (!apiKey) {
      throw new LlmProviderError('GEMINI_API_KEY is required for Gemini provider', 'gemini_missing_api_key');
    }

    return new GeminiLlmProvider(apiKey, model);
  }

  if (provider === 'modelscope') {
    const apiKey = process.env.MODELSCOPE_API_KEY;
    // Use the passed modelName if available, otherwise fallback to env
    const model = modelName || process.env.MODELSCOPE_MODEL || process.env.LLM_MODEL || 'qwen-plus';

    if (!apiKey) {
      throw new LlmProviderError('MODELSCOPE_API_KEY is required for ModelScope provider', 'modelscope_missing_api_key');
    }

    return new ModelScopeLlmProvider(apiKey, model);
  }

  if (provider === 'glm-flash') {
    const apiKey = process.env.GLM_FLASH_API_KEY;
    const apiUrl = process.env.GLM_FLASH_API_URL || 'https://api.example.com/glm-4flash';

    if (!apiKey) {
      throw new LlmProviderError('GLM_FLASH_API_KEY is required for GLM-Flash provider', 'glm_flash_missing_api_key');
    }

    return new GlmFlashLlmProvider(apiKey, apiUrl, 'glm-4-flash');
  }

  if (provider === 'glm-4.5-flash') {
    const apiKey = process.env.GLM_FLASH_API_KEY;
    const apiUrl = process.env.GLM_FLASH_API_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

    if (!apiKey) {
      throw new LlmProviderError('GLM_FLASH_API_KEY is required for GLM-4.5-Flash provider', 'glm_flash_missing_api_key');
    }

    return new GlmFlashLlmProvider(apiKey, apiUrl, 'glm-4.5-flash');
  }

  return new StubLlmProvider();
}

export function activeProviderName(): SupportedLlmProvider {
  return resolveProviderName();
}
