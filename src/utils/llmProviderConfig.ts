import { resolveUnifiedLlmConfig } from './aiEnv';
import { aiModelConfigService } from '../services/AiModelConfigService';

export interface LlmProviderConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  source?: 'database' | 'env';
}

type EnvLike = Record<string, string | undefined>;

export function resolveParsePrimaryConfig(env: EnvLike = process.env): LlmProviderConfig {
  const config = resolveUnifiedLlmConfig({
    env,
    providerEnvKeys: ['LLM_PARSE_PROVIDER', 'LLM_PROVIDER'],
    modelEnvKeys: ['LLM_PARSE_MODEL', 'OPENAI_MODEL', 'LLM_MODEL'],
  });
  return {
    provider: config.provider,
    model: config.model,
    source: 'env',
  };
}

export async function resolveParsePrimaryConfigAsync(): Promise<LlmProviderConfig> {
  try {
    const runtime = await aiModelConfigService.resolveRuntime('upload_parse');
    return {
      provider: runtime.provider,
      model: runtime.model,
      apiKey: runtime.apiKey || undefined,
      baseUrl: runtime.baseUrl || undefined,
      source: runtime.source,
    };
  } catch (error) {
    console.warn('[llmProviderConfig] async resolve failed, fallback to env:', error);
    return resolveParsePrimaryConfig();
  }
}
