import * as dotenv from 'dotenv';
import path from 'path';
import { OpenAILlmProvider } from '../src/services/OpenAILlmProvider';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function runTest() {
  const apiKey = process.env.OPENAI_API_KEY;
  const modelName = process.env.OPENAI_MODEL || process.env.LLM_MODEL || 'gpt-5.4';
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

  console.log('=========================================');
  console.log('  OpenAI Relay Connectivity Smoke Test');
  console.log('=========================================');
  console.log('Provider: openai');
  console.log(`Model: ${modelName}`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`API Mode: ${process.env.OPENAI_API_MODE || 'responses'}`);
  console.log(`Response Format: ${process.env.OPENAI_RESPONSE_FORMAT || 'json_schema'}`);

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is empty. Fill it in .env before running this test.');
  }

  const provider = new OpenAILlmProvider(apiKey, modelName);
  const response = await provider.generate(
    'Return a short JSON object confirming relay connectivity.',
    'You are a connectivity test assistant. Return JSON only.',
    {
      maxOutputTokens: 512,
      responseSchemaName: 'relay_connectivity',
      responseSchemaDescription: 'Connectivity smoke test for the OpenAI-compatible relay.',
      responseSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'message', 'model'],
        properties: {
          status: { type: 'string' },
          message: { type: 'string' },
          model: { type: 'string' },
        },
      },
      responseStrict: false,
    }
  );

  if (!response?.text || !String(response.text).trim()) {
    throw new Error('Relay returned an empty response body.');
  }

  console.log('-----------------------------------------');
  console.log('Relay response:');
  console.log(response.text);
  console.log('-----------------------------------------');
  console.log('Connectivity smoke test passed.');
}

runTest().catch((error) => {
  console.error('Connectivity smoke test failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
