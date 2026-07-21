import { resolveParsePrimaryConfig } from '../utils/llmProviderConfig';

describe('resolveParsePrimaryConfig', () => {
  it('uses GPT-5.5 from the unified OpenAI config', () => {
    const result = resolveParsePrimaryConfig({
      LLM_PARSE_PROVIDER: 'openai',
      LLM_PARSE_MODEL: 'gpt-5.5',
    });

    expect(result).toEqual({
      provider: 'openai',
      model: 'gpt-5.5',
      source: 'env',
    });
  });

  it('keeps alternate configured parse model names', () => {
    const result = resolveParsePrimaryConfig({
      LLM_PARSE_PROVIDER: 'openai',
      LLM_PARSE_MODEL: 'legacy-model',
      OPENAI_MODEL: 'gpt-5.5',
      LLM_MODEL: 'gpt-5.5',
    });

    expect(result).toEqual({
      provider: 'openai',
      model: 'legacy-model',
      source: 'env',
    });
  });
});
