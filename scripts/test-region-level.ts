import express from 'express';
import request from 'supertest';
import llmRegionsRouter from '../src/routes/llm-regions';
import pool from '../src/config/database-llm';

const app = express();
app.use(express.json());
app.use('/api/regions', llmRegionsRouter);

function buildPlaceholders(count: number): string {
  return Array.from({ length: count }, (_, idx) => `$${idx + 1}`).join(', ');
}

async function deleteByCodes(codes: string[]): Promise<void> {
  if (!codes.length) {
    return;
  }
  const placeholders = buildPlaceholders(codes.length);
  await pool.query(`DELETE FROM regions WHERE code IN (${placeholders})`, codes);
}

async function main(): Promise<void> {
  const timestamp = Date.now();
  const parentCode = `TEST-PARENT-${timestamp}`;
  const childCode = `TEST-CHILD-${timestamp}`;

  try {
    const parentRes = await request(app)
      .post('/api/regions')
      .send({
        code: parentCode,
        name: `测试父级-${timestamp}`,
        province: 'Test',
      });

    if (parentRes.status !== 201) {
      throw new Error(`Parent creation failed: ${parentRes.status} ${JSON.stringify(parentRes.body)}`);
    }

    const childRes = await request(app)
      .post('/api/regions')
      .send({
        code: childCode,
        name: `测试子级-${timestamp}`,
        parent_id: parentRes.body.id,
      });

    if (childRes.status !== 201) {
      throw new Error(`Child creation failed: ${childRes.status} ${JSON.stringify(childRes.body)}`);
    }

    if (parentRes.body.level !== 1) {
      throw new Error(`Expected parent level 1, got ${parentRes.body.level}`);
    }
    if (childRes.body.level !== 2) {
      throw new Error(`Expected child level 2, got ${childRes.body.level}`);
    }

    console.log('Region level logic passed: parent level 1, child level 2.');
  } finally {
    await deleteByCodes([childCode, parentCode]);
  }
}

main().catch((error) => {
  console.error('Region level test failed:', error);
  process.exit(1);
});
