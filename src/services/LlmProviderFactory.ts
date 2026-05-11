import { LlmProvider, LlmProviderError } from './LlmProvider';
import { GeminiLlmProvider } from './GeminiLlmProvider';
import { ModelScopeLlmProvider } from './ModelScopeLlmProvider';
import { NvidiaLlmProvider } from './NvidiaLlmProvider';
import { OpenAILlmProvider } from './OpenAILlmProvider';
import { ZhipuLlmProvider } from './ZhipuLlmProvider';
import { StubLlmProvider } from './StubLlmProvider';
import { resolveFirstNonEmpty } from '../utils/aiEnv';

export type SupportedLlmProvider =
  | 'stub'
  | 'openai'
  | 'gemini'
  | 'gemini_openai'
  | 'modelscope'
  | 'mimo'
  | 'zhipu'
  | 'nvidia'
  | 'deepseek'
  | 'kimi';

function resolveProviderName(): SupportedLlmProvider {
  const provider = (process.env.LLM_PROVIDER || 'stub').toLowerCase();
  if (provider === 'openai') {
    return 'openai';
  }
  if (provider === 'gemini') {
    return 'gemini';
  }
  if (provider === 'gemini_openai' || provider === 'gemini-openai') {
    return 'gemini_openai';
  }
  if (provider === 'modelscope') {
    return 'modelscope';
  }
  if (provider === 'mimo') {
    return 'mimo';
  }
  if (provider === 'zhipu') {
    return 'zhipu';
  }
  if (provider === 'nvidia' || provider === 'deepseek' || provider === 'kimi') {
    return provider as SupportedLlmProvider;
  }
  return 'stub';
}

export function createLlmProvider(providerName?: string, modelName?: string): LlmProvider {
  const provider = providerName ? (providerName.toLowerCase() as SupportedLlmProvider) : resolveProviderName();

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = resolveFirstNonEmpty(modelName, process.env.OPENAI_MODEL, process.env.LLM_MODEL);

    if (!apiKey) {
      throw new LlmProviderError('OPENAI_API_KEY is required for OpenAI provider', 'openai_missing_api_key');
    }
    if (!model) {
      throw new LlmProviderError('OPENAI_MODEL or LLM_MODEL is required for OpenAI provider', 'openai_missing_model');
    }

    return new OpenAILlmProvider(apiKey, model);
  }

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = resolveFirstNonEmpty(modelName, process.env.GEMINI_MODEL, process.env.LLM_MODEL);

    if (!apiKey) {
      throw new LlmProviderError('GEMINI_API_KEY is required for Gemini provider', 'gemini_missing_api_key');
    }
    if (!model) {
      throw new LlmProviderError('GEMINI_MODEL or LLM_MODEL is required for Gemini provider', 'gemini_missing_model');
    }

    return new GeminiLlmProvider(apiKey, model);
  }

  if (provider === 'gemini_openai') {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = resolveFirstNonEmpty(modelName, process.env.GEMINI_MODEL, process.env.LLM_MODEL);
    const baseURL = resolveFirstNonEmpty(process.env.GEMINI_OPENAI_BASE_URL);
    const apiMode = (process.env.GEMINI_OPENAI_API_MODE || 'chat_completions').trim().toLowerCase();

    if (!apiKey) {
      throw new LlmProviderError(
        'GEMINI_API_KEY is required for Gemini OpenAI-compatible provider',
        'gemini_openai_missing_api_key'
      );
    }
    if (!model) {
      throw new LlmProviderError(
        'GEMINI_MODEL or LLM_MODEL is required for Gemini OpenAI-compatible provider',
        'gemini_openai_missing_model'
      );
    }
    if (!baseURL) {
      throw new LlmProviderError(
        'GEMINI_OPENAI_BASE_URL is required for Gemini OpenAI-compatible provider',
        'gemini_openai_missing_base_url'
      );
    }

    return new OpenAILlmProvider(apiKey, model, {
      baseURL,
      apiMode,
      providerLabel: 'gemini_openai',
    });
  }

  if (provider === 'modelscope') {
    const apiKey = process.env.MODELSCOPE_API_KEY;
    const model = resolveFirstNonEmpty(modelName, process.env.MODELSCOPE_MODEL, process.env.LLM_MODEL);

    if (!apiKey) {
      throw new LlmProviderError('MODELSCOPE_API_KEY is required for ModelScope provider', 'modelscope_missing_api_key');
    }
    if (!model) {
      throw new LlmProviderError(
        'MODELSCOPE_MODEL or LLM_MODEL is required for ModelScope provider',
        'modelscope_missing_model'
      );
    }

    return new ModelScopeLlmProvider(apiKey, model);
  }

  if (provider === 'mimo') {
    const apiKey = process.env.MIMO_API_KEY;
    const model = resolveFirstNonEmpty(modelName, process.env.MIMO_MODEL, process.env.LLM_MODEL);
    const baseURL = resolveFirstNonEmpty(process.env.MIMO_BASE_URL);
    const apiMode = (process.env.MIMO_API_MODE || 'chat_completions').trim().toLowerCase();

    if (!apiKey) {
      throw new LlmProviderError('MIMO_API_KEY is required for MiMo provider', 'mimo_missing_api_key');
    }
    if (!model) {
      throw new LlmProviderError('MIMO_MODEL or LLM_MODEL is required for MiMo provider', 'mimo_missing_model');
    }
    if (!baseURL) {
      throw new LlmProviderError('MIMO_BASE_URL is required for MiMo provider', 'mimo_missing_base_url');
    }

    return new OpenAILlmProvider(apiKey, model, {
      baseURL,
      apiMode,
      providerLabel: 'mimo',
    });
  }

  if (provider === 'nvidia' || provider === 'deepseek' || provider === 'kimi') {
    const apiKey = process.env.NVIDIA_API_KEY;
    const model = resolveFirstNonEmpty(
      modelName,
      provider === 'kimi' ? process.env.KIMI_MODEL : process.env.NVIDIA_MODEL,
      process.env.LLM_MODEL
    );

    if (!apiKey) {
      throw new LlmProviderError('NVIDIA_API_KEY is required for Nvidia/DeepSeek provider', 'nvidia_missing_api_key');
    }
    if (!model) {
      throw new LlmProviderError('NVIDIA_MODEL, KIMI_MODEL, or LLM_MODEL is required for Nvidia provider', 'nvidia_missing_model');
    }

    return new NvidiaLlmProvider(apiKey, model);
  }

  if (provider === 'zhipu') {
    const apiKey = process.env.ZHIPU_API_KEY;
    const model = resolveFirstNonEmpty(modelName, process.env.ZHIPU_MODEL, process.env.LLM_MODEL);

    if (!apiKey) {
      throw new LlmProviderError('ZHIPU_API_KEY is required for Zhipu provider', 'zhipu_missing_api_key');
    }
    if (!model) {
      throw new LlmProviderError('ZHIPU_MODEL or LLM_MODEL is required for Zhipu provider', 'zhipu_missing_model');
    }

    return new ZhipuLlmProvider(apiKey, model);
  }

  return new StubLlmProvider();
}

export function activeProviderName(): SupportedLlmProvider {
  return resolveProviderName();
}
