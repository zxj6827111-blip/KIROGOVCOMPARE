import { resolveParseFallbackConfig } from '../utils/llmProviderConfig';

describe('resolveParseFallbackConfig', () => {
  it('skips parse-specific fallback when its credentials are missing and uses global fallback', () => {
    const result = resolveParseFallbackConfig({
      LLM_PARSE_PROVIDER: 'gemini',
      LLM_PARSE_MODEL: 'gemini-3.1-flash-lite-preview',
      LLM_PARSE_FALLBACK_PROVIDER: 'zhipu',
      LLM_FALLBACK_PROVIDER: 'gemini_openai',
      LLM_FALLBACK_MODEL: 'gemini-3.1-flash-lite-preview',
      GEMINI_API_KEY: 'gemini-key',
      GEMINI_OPENAI_BASE_URL: 'https://example.invalid/v1beta/openai',
      ZHIPU_API_KEY: '',
    });

    expect(result.provider).toBe('gemini_openai');
    expect(result.model).toBe('gemini-3.1-flash-lite-preview');
    expect(result.source).toBe('global_fallback');
    expect(result.skipped).toEqual([
      expect.objectContaining({
        provider: 'zhipu',
        source: 'parse_fallback',
        reason: 'ZHIPU_API_KEY is missing',
      }),
    ]);
  });

  it('prefers parse-specific fallback when it is fully configured', () => {
    const result = resolveParseFallbackConfig({
      LLM_PARSE_PROVIDER: 'gemini',
      LLM_PARSE_MODEL: 'gemini-3.1-flash-lite-preview',
      LLM_PARSE_FALLBACK_PROVIDER: 'zhipu',
      LLM_PARSE_FALLBACK_MODEL: 'glm-5',
      LLM_FALLBACK_PROVIDER: 'gemini_openai',
      LLM_FALLBACK_MODEL: 'gemini-3.1-flash-lite-preview',
      GEMINI_API_KEY: 'gemini-key',
      GEMINI_OPENAI_BASE_URL: 'https://example.invalid/v1beta/openai',
      ZHIPU_API_KEY: 'zhipu-key',
    });

    expect(result.provider).toBe('zhipu');
    expect(result.model).toBe('glm-5');
    expect(result.source).toBe('parse_fallback');
    expect(result.skipped).toHaveLength(0);
  });

  it('falls back to the primary parse provider when both fallback providers are unusable', () => {
    const result = resolveParseFallbackConfig({
      LLM_PARSE_PROVIDER: 'gemini',
      LLM_PARSE_MODEL: 'gemini-3.1-flash-lite-preview',
      LLM_PARSE_FALLBACK_PROVIDER: 'zhipu',
      LLM_PARSE_FALLBACK_MODEL: 'glm-5',
      LLM_FALLBACK_PROVIDER: 'openai',
      LLM_FALLBACK_MODEL: 'gpt-5.4-mini',
      GEMINI_API_KEY: 'gemini-key',
      ZHIPU_API_KEY: '',
      OPENAI_API_KEY: '',
    });

    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-3.1-flash-lite-preview');
    expect(result.source).toBe('primary');
    expect(result.skipped).toEqual([
      expect.objectContaining({
        provider: 'zhipu',
        source: 'parse_fallback',
      }),
      expect.objectContaining({
        provider: 'openai',
        source: 'global_fallback',
      }),
    ]);
  });
});
