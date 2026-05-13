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
    });
  });

  it('normalizes any alternate configured parse model to GPT-5.5', () => {
    const result = resolveParsePrimaryConfig({
      LLM_PARSE_PROVIDER: 'openai',
      LLM_PARSE_MODEL: 'legacy-model',
    });

    expect(result).toEqual({
      provider: 'openai',
      model: 'gpt-5.5',
    });
  });
});
