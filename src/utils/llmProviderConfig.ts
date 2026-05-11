import { resolveFirstNonEmpty } from './aiEnv';

export interface LlmProviderConfig {
  provider: string;
  model: string;
}

export interface SkippedLlmProviderCandidate extends LlmProviderConfig {
  reason: string;
  source: 'parse_fallback' | 'global_fallback' | 'primary';
}

export interface ResolvedParseFallbackConfig extends LlmProviderConfig {
  source: 'parse_fallback' | 'global_fallback' | 'primary';
  skipped: SkippedLlmProviderCandidate[];
}

type EnvLike = Record<string, string | undefined>;

function normalizeProviderName(providerName: string | undefined, fallback: string = ''): string {
  const normalized = String(providerName || '').trim().toLowerCase();
  if (normalized === 'gemini-openai') {
    return 'gemini_openai';
  }
  return normalized || fallback;
}

function resolveModelForProvider(provider: string, preferredModel: string, env: EnvLike): string {
  if (provider === 'openai') {
    return resolveFirstNonEmpty(preferredModel, env.OPENAI_MODEL, env.LLM_MODEL);
  }

  if (provider === 'gemini' || provider === 'gemini_openai') {
    return resolveFirstNonEmpty(preferredModel, env.GEMINI_MODEL, env.LLM_MODEL);
  }

  if (provider === 'modelscope') {
    return resolveFirstNonEmpty(preferredModel, env.MODELSCOPE_MODEL, env.LLM_MODEL);
  }

  if (provider === 'mimo') {
    return resolveFirstNonEmpty(preferredModel, env.MIMO_MODEL, env.LLM_MODEL);
  }

  if (provider === 'nvidia' || provider === 'deepseek') {
    return resolveFirstNonEmpty(preferredModel, env.NVIDIA_MODEL, env.LLM_MODEL);
  }

  if (provider === 'kimi') {
    return resolveFirstNonEmpty(preferredModel, env.KIMI_MODEL, env.NVIDIA_MODEL, env.LLM_MODEL);
  }

  if (provider === 'zhipu') {
    return resolveFirstNonEmpty(preferredModel, env.ZHIPU_MODEL, env.LLM_MODEL);
  }

  return preferredModel;
}

function validateProviderConfig(providerName: string, modelName: string, env: EnvLike): string | null {
  const provider = normalizeProviderName(providerName);
  const model = String(modelName || '').trim();

  if (!provider) {
    return 'provider is empty';
  }

  if (provider === 'stub') {
    return null;
  }

  if (!model) {
    return 'model is empty';
  }

  if (provider === 'openai') {
    return env.OPENAI_API_KEY ? null : 'OPENAI_API_KEY is missing';
  }

  if (provider === 'gemini') {
    return env.GEMINI_API_KEY ? null : 'GEMINI_API_KEY is missing';
  }

  if (provider === 'gemini_openai') {
    if (!env.GEMINI_API_KEY) {
      return 'GEMINI_API_KEY is missing';
    }
    if (!env.GEMINI_OPENAI_BASE_URL) {
      return 'GEMINI_OPENAI_BASE_URL is missing';
    }
    return null;
  }

  if (provider === 'modelscope') {
    return env.MODELSCOPE_API_KEY ? null : 'MODELSCOPE_API_KEY is missing';
  }

  if (provider === 'mimo') {
    if (!env.MIMO_API_KEY) {
      return 'MIMO_API_KEY is missing';
    }
    if (!env.MIMO_BASE_URL) {
      return 'MIMO_BASE_URL is missing';
    }
    return null;
  }

  if (provider === 'zhipu') {
    return env.ZHIPU_API_KEY ? null : 'ZHIPU_API_KEY is missing';
  }

  if (provider === 'nvidia' || provider === 'deepseek' || provider === 'kimi') {
    return env.NVIDIA_API_KEY ? null : 'NVIDIA_API_KEY is missing';
  }

  return null;
}

export function resolveParsePrimaryConfig(env: EnvLike = process.env): LlmProviderConfig {
  const provider = normalizeProviderName(env.LLM_PARSE_PROVIDER, normalizeProviderName(env.LLM_PROVIDER, 'stub'));
  const model = resolveFirstNonEmpty(env.LLM_PARSE_MODEL, env.LLM_MODEL, 'default');
  return { provider, model };
}

export function resolveParseFallbackConfig(env: EnvLike = process.env): ResolvedParseFallbackConfig {
  const primary = resolveParsePrimaryConfig(env);
  const skipped: SkippedLlmProviderCandidate[] = [];
  const seenCandidates = new Set<string>();

  const candidates: Array<{
    provider: string;
    rawModel: string;
    source: 'parse_fallback' | 'global_fallback' | 'primary';
  }> = [
    {
      provider: normalizeProviderName(env.LLM_PARSE_FALLBACK_PROVIDER),
      rawModel: resolveFirstNonEmpty(env.LLM_PARSE_FALLBACK_MODEL, env.LLM_FALLBACK_MODEL, primary.model),
      source: 'parse_fallback',
    },
    {
      provider: normalizeProviderName(env.LLM_FALLBACK_PROVIDER),
      rawModel: resolveFirstNonEmpty(env.LLM_FALLBACK_MODEL, primary.model),
      source: 'global_fallback',
    },
    {
      provider: primary.provider,
      rawModel: primary.model,
      source: 'primary',
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.provider) {
      continue;
    }

    const model = resolveModelForProvider(candidate.provider, candidate.rawModel, env);
    const key = `${candidate.provider}::${model}`;
    if (seenCandidates.has(key)) {
      continue;
    }
    seenCandidates.add(key);

    const reason = validateProviderConfig(candidate.provider, model, env);
    if (!reason) {
      return {
        provider: candidate.provider,
        model,
        source: candidate.source,
        skipped,
      };
    }

    skipped.push({
      provider: candidate.provider,
      model,
      source: candidate.source,
      reason,
    });
  }

  return {
    provider: candidates[0]?.provider || primary.provider,
    model: resolveModelForProvider(
      candidates[0]?.provider || primary.provider,
      candidates[0]?.rawModel || primary.model,
      env
    ),
    source: candidates[0]?.source || 'primary',
    skipped,
  };
}
