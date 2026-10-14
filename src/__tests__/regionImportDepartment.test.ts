import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import regionsImportRouter from '../routes/regions-import';
import llmRegionsRouter from '../routes/llm-regions';

const mockQuery = jest.fn();

jest.mock('../config/database-llm', () => ({
  __esModule: true,
  default: {
    query: (...args: any[]) => mockQuery(...args),
    connect: () => ({ query: mockQuery, release: () => undefined }),
  },
}));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: any, _res: any, next: () => void) => next(),
  requirePermission: () => (_req: any, _res: any, next: () => void) => next(),
}));

// write-excel-file pulls an ESM-only zip dependency that jest cannot load in CJS
// mode; the import endpoint under test only reads CSV, so the xlsx writer is stubbed.
jest.mock('write-excel-file/node', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ toBuffer: async () => Buffer.from('') })),
}));

/**
 * In-memory `regions` table big enough for the import walk: the import only
 * reads (id, name, level, parent_id) and inserts one node at a time.
 */
class FakeRegions {
  rows: { id: number; name: string; level: number; parent_id: number | null; is_department: boolean | null }[] = [];
  nextId = 1;

  seed(name: string, level: number, parentId: number | null) {
    const id = this.nextId++;
    this.rows.push({ id, name, level, parent_id: parentId, is_department: null });
    return id;
  }

  find(name: string, level: number) {
    return this.rows.find((r) => r.name === name && r.level === level) || null;
  }
}

let store: FakeRegions;

function createImportApp() {
  const app = express();
  app.use('/api/regions', regionsImportRouter);
  return app;
}

function createTreeApp() {
  const app = express();
  app.use('/api/regions', llmRegionsRouter);
  return app;
}

beforeEach(() => {
  store = new FakeRegions();
  mockQuery.mockImplementation((sql: string, params: any[] = []) => {
    if (/INSERT INTO regions/i.test(sql)) {
      const [, name, level, parentId, isDepartment] = params;
      const id = store.nextId++;
      store.rows.push({
        id,
        name,
        level: Number(level),
        parent_id: parentId === null || parentId === undefined ? null : Number(parentId),
        is_department: isDepartment === undefined ? null : isDepartment,
      });
      return Promise.resolve({ rows: [{ id }] });
    }
    if (/SELECT id, name, level, parent_id FROM regions/i.test(sql)) {
      return Promise.resolve({ rows: [...store.rows] });
    }
    if (/FROM regions/i.test(sql)) {
      return Promise.resolve({ rows: [...store.rows] });
    }
    return Promise.resolve({ rows: [] });
  });
});

afterEach(() => {
  const tempDir = path.join(process.cwd(), 'data', 'temp');
  if (fs.existsSync(tempDir)) {
    for (const file of fs.readdirSync(tempDir)) {
      if (file.startsWith('import_')) fs.unlinkSync(path.join(tempDir, file));
    }
  }
});

async function uploadCsv(csv: string) {
  const res = await request(createImportApp())
    .post('/api/regions/import')
    .attach('file', Buffer.from(csv, 'utf8'), { filename: 'regions.csv', contentType: 'text/csv' });
  return res.text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('regions.is_department migration wiring', () => {
  it('is registered so the column appears on every boot', async () => {
    const registry = fs.readFileSync(path.join(process.cwd(), 'src/db/migrationRegistry.ts'), 'utf8');
    expect(registry).toMatch(/0004_region_department_flag/);
    expect(registry).toMatch(/ensureRegionDepartmentSchema/);

    const { ensureRegionDepartmentSchema } = await import('../db/regionDepartmentSchema');
    const queries: string[] = [];
    await ensureRegionDepartmentSchema({
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [] };
      },
    });
    expect(queries.join(' ')).toMatch(/ALTER TABLE regions ADD COLUMN IF NOT EXISTS is_department BOOLEAN/);
    // 不做回填：NULL 表示"未声明，按名称分类"，避免一次生产级 bulk UPDATE
    expect(queries.join(' ')).not.toMatch(/UPDATE regions/i);
  });
});

describe('POST /regions/import 部门列', () => {
  it('creates departments under the banner at level 4 with is_department = true', async () => {
    const province = store.seed('内蒙古自治区', 1, null);
    const city = store.seed('鄂尔多斯市', 2, province);
    store.seed('伊金霍洛旗', 3, city);

    const frames = await uploadCsv(`省份,城市,区县,街道,部门
内蒙古自治区,鄂尔多斯市,伊金霍洛旗,阿勒腾席热镇,
内蒙古自治区,鄂尔多斯市,伊金霍洛旗,,伊金霍洛旗财政局
内蒙古自治区,鄂尔多斯市,伊金霍洛旗,,伊金霍洛旗自然资源局
`);

    const final = frames[frames.length - 1];
    expect(final.percentage).toBe(100);
    expect(final.skipped).toBe(0);
    expect(final.created).toBe(3);

    const banner = store.find('伊金霍洛旗', 3)!;
    const town = store.find('阿勒腾席热镇', 4)!;
    expect(town.parent_id).toBe(banner.id);
    expect(town.is_department).toBeNull();

    const finance = store.find('伊金霍洛旗财政局', 4)!;
    expect(finance.parent_id).toBe(banner.id);
    expect(finance.is_department).toBe(true);

    const naturalResources = store.find('伊金霍洛旗自然资源局', 4)!;
    expect(naturalResources.is_department).toBe(true);
  });

  it('re-running the same workbook creates nothing and keeps ids stable', async () => {
    const province = store.seed('内蒙古自治区', 1, null);
    const city = store.seed('鄂尔多斯市', 2, province);
    store.seed('伊金霍洛旗', 3, city);
    const bannerId = store.find('伊金霍洛旗', 3)!.id;
    store.rows.push({ id: store.nextId++, name: '伊金霍洛旗财政局', level: 4, parent_id: bannerId, is_department: true });

    const frames = await uploadCsv(`省份,城市,区县,街道,部门
内蒙古自治区,鄂尔多斯市,伊金霍洛旗,,伊金霍洛旗财政局
`);
    const final = frames[frames.length - 1];
    expect(final.created).toBe(0);
    expect(store.find('伊金霍洛旗财政局', 4)!.id).toBe(4);
  });

  it('reports the row instead of silently dropping a non-contiguous chain', async () => {
    const frames = await uploadCsv(`省份,城市,区县,街道,部门
内蒙古自治区,,,准格尔旗,
`);
    const final = frames[frames.length - 1];
    expect(final.skipped).toBe(1);
    expect(final.row_errors[0]).toContain('连续填写');
    expect(store.find('准格尔旗', 3)).toBeNull();
  });

  it('warns that a direct-controlled municipality ignores the 街道 column', async () => {
    const frames = await uploadCsv(`省份,城市,区县,街道,部门
上海市,黄浦区,南京东路街道,被忽略的第四列,
`);
    const final = frames[frames.length - 1];
    expect(final.skipped).toBe(0);
    expect(final.row_warnings[0]).toContain('直辖市');
    // 省/市/区 三级仍然入库
    expect(store.find('黄浦区', 2)).not.toBeNull();
    expect(store.find('南京东路街道', 3)).not.toBeNull();
    expect(store.find('被忽略的第四列', 4)).toBeNull();
  });
});

describe('GET /regions exposes the resolved department flag', () => {
  it('marks banner children as departments and banners as administrative', async () => {
    const province = store.seed('内蒙古自治区', 1, null);
    const city = store.seed('鄂尔多斯市', 2, province);
    const banner = store.seed('伊金霍洛旗', 3, city);
    store.rows.push({ id: store.nextId++, name: '伊金霍洛旗财政局', level: 4, parent_id: banner, is_department: null });
    store.rows.push({ id: store.nextId++, name: '展旦召苏木', level: 4, parent_id: banner, is_department: null });

    const res = await request(createTreeApp()).get('/api/regions').expect(200);
    const byName = new Map<string, any>(
      res.body.data.map((row: any) => [row.name, row] as [string, any])
    );

    expect(byName.get('伊金霍洛旗').is_department).toBe(false);
    expect(byName.get('展旦召苏木').is_department).toBe(false);
    expect(byName.get('伊金霍洛旗财政局').is_department).toBe(true);
  });

  it('keeps a manually declared administrative node out of the department group', async () => {
    const banner = store.seed('伊金霍洛旗', 3, null);
    store.rows.push({ id: store.nextId++, name: '东胜区人民政府', level: 4, parent_id: banner, is_department: false });

    const res = await request(createTreeApp()).get('/api/regions').expect(200);
    const row = res.body.data.find((item: any) => item.name === '东胜区人民政府');
    expect(row.is_department).toBe(false);
  });
});
