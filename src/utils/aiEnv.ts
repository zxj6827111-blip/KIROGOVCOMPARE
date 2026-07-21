export interface RuntimeModelOption {
  value: string;
  label: string;
}

export const DEFAULT_LLM_PROVIDER = 'openai';
export const DEFAULT_LLM_MODEL = 'gpt-5.5';

export interface UnifiedLlmConfig {
  provider: string;
  model: string;
  modelValue: string;
}

export function resolveFirstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) {
      return text;
    }
  }
  return '';
}

export function normalizeLlmProviderName(providerName: string | undefined, fallback: string = ''): string {
  const normalized = String(providerName || '').trim().toLowerCase();
  if (normalized === 'gemini-openai') {
    return 'gemini_openai';
  }
  return normalized || fallback;
}

export function buildPrefixedModelValue(providerName: string, modelName: string): string {
  const provider = normalizeLlmProviderName(providerName);
  const model = String(modelName || '').trim();

  if (!provider || !model) {
    return model;
  }

  return `${provider}/${model}`;
}

export function parsePrefixedModelValue(input: string | undefined): { provider?: string; model?: string } {
  const value = String(input || '').trim();
  const slashIndex = value.indexOf('/');
  if (slashIndex <= 0 || slashIndex === value.length - 1) {
    return { model: value || undefined };
  }

  return {
    provider: normalizeLlmProviderName(value.slice(0, slashIndex)),
    model: value.slice(slashIndex + 1).trim() || undefined,
  };
}

function normalizeRuntimeModelName(modelName: string | undefined): string {
  const text = String(modelName || '').trim();
  return text || DEFAULT_LLM_MODEL;
}

export function resolveUnifiedLlmConfig(options: {
  env?: Record<string, string | undefined>;
  provider?: string;
  model?: string;
  providerEnvKeys?: string[];
  modelEnvKeys?: string[];
} = {}): UnifiedLlmConfig {
  const env = options.env || process.env;
  const providerEnvKeys = options.providerEnvKeys || ['LLM_PROVIDER'];
  const modelEnvKeys = options.modelEnvKeys || ['OPENAI_MODEL', 'LLM_MODEL'];

  const explicit = parsePrefixedModelValue(options.model);
  const explicitModel = String(explicit.model || '').trim();
  const explicitModelAllowed = Boolean(explicitModel);
  const providerFromEnv = resolveFirstNonEmpty(...providerEnvKeys.map((key) => env[key]));
  const modelFromEnv = resolveFirstNonEmpty(...modelEnvKeys.map((key) => env[key]));

  const provider = normalizeLlmProviderName(
    options.provider || (explicitModelAllowed ? explicit.provider : undefined) || providerFromEnv,
    DEFAULT_LLM_PROVIDER
  );
  const model = normalizeRuntimeModelName(
    explicitModelAllowed ? explicitModel : resolveFirstNonEmpty(modelFromEnv, DEFAULT_LLM_MODEL)
  );

  return {
    provider,
    model,
    modelValue: buildPrefixedModelValue(provider, model),
  };
}

function normalizeRuntimeModelOption(input: unknown): RuntimeModelOption | null {
  if (typeof input === 'string') {
    const value = input.trim();
    if (!value) return null;
    return {
      value,
      label: value,
    };
  }

  if (!input || typeof input !== 'object') {
    return null;
  }

  const record = input as Record<string, unknown>;
  const value = String(record.value || '').trim();
  const label = String(record.label || record.name || record.value || '').trim();
  if (!value || !label) {
    return null;
  }

  return { value, label };
}

export function parseRuntimeModelOptions(raw: string | undefined): RuntimeModelOption[] {
  const text = String(raw || '').trim();
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => normalizeRuntimeModelOption(item))
      .filter((item): item is RuntimeModelOption => Boolean(item));
  } catch (error) {
    console.warn('[AI Config] Failed to parse model options JSON:', error);
    return [];
  }
}

export function resolveParseDefaultModelValue(): string {
  return resolveUnifiedLlmConfig({
    providerEnvKeys: ['LLM_PARSE_PROVIDER', 'LLM_PROVIDER'],
    modelEnvKeys: ['LLM_PARSE_MODEL', 'OPENAI_MODEL', 'LLM_MODEL'],
  }).modelValue;
}

export function resolveParseUploadModelOptions(): {
  defaultModel: string;
  options: RuntimeModelOption[];
} {
  const defaultModel = resolveParseDefaultModelValue();
  const label = defaultModel.endsWith(`/${DEFAULT_LLM_MODEL}`) ? 'GPT-5.5' : defaultModel;
  const options = defaultModel ? [{ value: defaultModel, label }] : [];

  return {
    defaultModel: defaultModel || options[0]?.value || '',
    options,
  };
}
