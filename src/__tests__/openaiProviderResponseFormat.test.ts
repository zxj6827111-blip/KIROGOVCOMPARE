import { OpenAILlmProvider } from '../services/OpenAILlmProvider';

describe('OpenAILlmProvider chat response format', () => {
  it('uses json_schema when a response schema is provided', () => {
    const provider = new OpenAILlmProvider('test-key', 'gpt-test', {
      baseURL: 'https://api.openai.com/v1',
      apiMode: 'chat_completions',
    });
    const schema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
      },
      required: ['title'],
      additionalProperties: false,
    };

    const format = (provider as any).buildChatResponseFormat({
      responseMimeType: 'application/json',
      responseSchema: schema,
      responseSchemaName: 'govinsight_report',
      responseSchemaDescription: 'GovInsight report schema.',
      responseStrict: true,
    });

    expect(format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'govinsight_report',
        description: 'GovInsight report schema.',
        schema,
        strict: true,
      },
    });
  });

  it('keeps json_object fallback for JSON requests without a schema', () => {
    const provider = new OpenAILlmProvider('test-key', 'gpt-test', {
      baseURL: 'https://api.openai.com/v1',
      apiMode: 'chat_completions',
    });

    const format = (provider as any).buildChatResponseFormat({
      responseMimeType: 'application/json',
    });

    expect(format).toEqual({ type: 'json_object' });
  });
});
