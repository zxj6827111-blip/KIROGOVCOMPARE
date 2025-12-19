import { LlmProvider, LlmProviderError } from './LlmProvider';
import { GeminiLlmProvider } from './GeminiLlmProvider';
import { StubLlmProvider } from './StubLlmProvider';

export type SupportedLlmProvider = 'stub' | 'gemini';

function resolveProviderName(): SupportedLlmProvider {
  const provider = (process.env.LLM_PROVIDER || 'stub').toLowerCase();
  if (provider === 'gemini') {
    return 'gemini';
  }
  return 'stub';
}

export function createLlmProvider(): LlmProvider {
  const provider = resolveProviderName();

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    if (!apiKey) {
      throw new LlmProviderError('GEMINI_API_KEY is required for Gemini provider', 'gemini_missing_api_key');
    }

    return new GeminiLlmProvider(apiKey, model);
  }

  return new StubLlmProvider();
}

export function activeProviderName(): SupportedLlmProvider {
  return resolveProviderName();
}
