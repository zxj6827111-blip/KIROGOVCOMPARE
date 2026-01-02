import { LlmProvider, LlmProviderError } from './LlmProvider';
import { GeminiLlmProvider } from './GeminiLlmProvider';
import { ModelScopeLlmProvider } from './ModelScopeLlmProvider';
import { StubLlmProvider } from './StubLlmProvider';

export type SupportedLlmProvider = 'stub' | 'gemini' | 'modelscope';

function resolveProviderName(): SupportedLlmProvider {
  const provider = (process.env.LLM_PROVIDER || 'stub').toLowerCase();
  if (provider === 'gemini') {
    return 'gemini';
  }
  if (provider === 'modelscope') {
    return 'modelscope';
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

  return new StubLlmProvider();
}

export function activeProviderName(): SupportedLlmProvider {
  return resolveProviderName();
}
