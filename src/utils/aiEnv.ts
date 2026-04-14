export interface RuntimeModelOption {
  value: string;
  label: string;
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

export function buildPrefixedModelValue(providerName: string, modelName: string): string {
  const provider = String(providerName || '').trim().toLowerCase();
  const model = String(modelName || '').trim();

  if (!provider || !model) {
    return model;
  }

  if (provider === 'deepseek' || provider === 'kimi') {
    return `nvidia/${model}`;
  }

  if (provider === 'gemini-openai') {
    return `gemini_openai/${model}`;
  }

  return `${provider}/${model}`;
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
  const provider = resolveFirstNonEmpty(process.env.LLM_PARSE_PROVIDER, process.env.LLM_PROVIDER);
  const model = resolveFirstNonEmpty(process.env.LLM_PARSE_MODEL, process.env.LLM_MODEL);
  return buildPrefixedModelValue(provider, model);
}

export function resolveParseUploadModelOptions(): {
  defaultModel: string;
  options: RuntimeModelOption[];
} {
  const defaultModel = resolveParseDefaultModelValue();
  const configuredOptions = parseRuntimeModelOptions(process.env.LLM_PARSE_MODEL_OPTIONS_JSON);

  let options = configuredOptions;
  if (defaultModel && !configuredOptions.some((item) => item.value === defaultModel)) {
    options = [{ value: defaultModel, label: defaultModel }, ...configuredOptions];
  }

  return {
    defaultModel: defaultModel || options[0]?.value || '',
    options,
  };
}
