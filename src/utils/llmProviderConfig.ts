import { resolveUnifiedLlmConfig } from './aiEnv';

export interface LlmProviderConfig {
  provider: string;
  model: string;
}

type EnvLike = Record<string, string | undefined>;

export function resolveParsePrimaryConfig(env: EnvLike = process.env): LlmProviderConfig {
  const config = resolveUnifiedLlmConfig({
    env,
    providerEnvKeys: ['LLM_PARSE_PROVIDER', 'LLM_PROVIDER'],
    modelEnvKeys: ['LLM_PARSE_MODEL', 'OPENAI_MODEL', 'LLM_MODEL'],
  });
  return { provider: config.provider, model: config.model };
}
