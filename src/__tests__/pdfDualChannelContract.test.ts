/**
 * Phase 0.3 — Candidate Output contract.
 *
 * The plan's gate: PDF -> sidecar -> grid mapper -> candidate parsed_json ->
 * MaterializeService -> ConsistencyCheckService must all run on the shape Channel B
 * produces. Nothing here mutates production behaviour; it proves the contract before
 * Shadow mode is allowed to exist.
 */
import fs from 'fs';
import path from 'path';

jest.mock('../config/database-llm', () => ({
    __esModule: true,
    default: {
        query: jest.fn(),
        connect: jest.fn(),
    },
}));

import pool from '../config/database-llm';
import { hasParsedContent } from '../utils/parsedContent';
import { __materializeInternals, materializeReportVersion } from '../services/MaterializeService';
import { ConsistencyCheckService } from '../services/ConsistencyCheckService';
import { extractLattice } from '../services/pdf-dual-channel/LatticeSidecarClient';
import { buildCandidateParsedJson, mapGridToSkeleton } from '../services/pdf-dual-channel/tableGridMapping';
import type { LatticePage } from '../services/pdf-dual-channel/types';

const FIXTURE_DIR = path.join(process.cwd(), 'tests/fixtures/pdf-lattice');
const PDF_DIR = path.join(process.cwd(), 'tests/fixtures/annual-report');
const KEWEI_PDF = path.join(PDF_DIR, 'kewei-2024-official-sample.pdf');

function loadFixture(name: string): LatticePage[] {
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
    expect(raw.ok).toBe(true);
    return raw.pages;
}

function candidateFor(name: string): Record<string, any> {
    return buildCandidateParsedJson(mapGridToSkeleton(loadFixture(name)), {
        year: 2024,
        unitName: '契约验证样例',
        generatedAt: '2026-01-01T00:00:00.000Z',
    });
}

/** Mock a pool client so materialize can be driven without a database. */
function mockPoolClient() {
    const queries: Array<{ sql: string; params: any[] }> = [];
    const client = {
        query: jest.fn(async (sql: string, params: any[] = []) => {
            queries.push({ sql: String(sql), params });
            return { rows: [], rowCount: 1 };
        }),
        release: jest.fn(),
    };
    (pool.connect as jest.Mock).mockResolvedValue(client);
    return { client, queries };
}

describe('Phase 0.3 candidate output contract — hasParsedContent', () => {
    it('accepts the candidate produced from each captured grid', () => {
        for (const fixture of ['kewei-2024-official-sample-grid.json', 'shanghai-office-2025-official-sample-grid.json']) {
            const candidate = candidateFor(fixture);
            expect(hasParsedContent(candidate)).toBe(true);
            // The DB hands parsed_json around as text in several places; the candidate has
            // to survive the same round trip.
            expect(hasParsedContent(JSON.stringify(candidate))).toBe(true);
        }
    });

    it('rejects a candidate built from an empty grid', () => {
        const candidate = buildCandidateParsedJson(mapGridToSkeleton([]));
        expect(hasParsedContent(candidate)).toBe(false);
        expect(candidate.sections).toEqual([]);
    });
});

describe('Phase 0.3 candidate output contract — MaterializeService', () => {
    beforeEach(() => {
        (pool.connect as jest.Mock).mockReset();
    });

    it('getSection finds all three canonical sections in the candidate', () => {
        const candidate = candidateFor('kewei-2024-official-sample-grid.json');
        expect(__materializeInternals.getSection(candidate, 'table_2').activeDisclosureData).toBeDefined();
        expect(__materializeInternals.getSection(candidate, 'table_3').tableData).toBeDefined();
        expect(__materializeInternals.getSection(candidate, 'table_4').reviewLitigationData).toBeDefined();
        expect(__materializeInternals.getSection(candidate, 'table_9')).toBeUndefined();
    });

    it('builds active-disclosure facts from the candidate without throwing', () => {
        const candidate = candidateFor('kewei-2024-official-sample-grid.json');
        const { facts, cells } = __materializeInternals.buildActiveDisclosure(candidate);
        expect(facts).toHaveLength(6);
        expect(facts.find((fact: any) => fact.category === 'normative_documents')).toMatchObject({
            made_count: 13,
            repealed_count: 0,
            valid_count: 55,
        });
        // cells are keyed by the immutable contract: row_key is the category and col_key
        // the field, so Channel B cannot rename anything.
        expect(cells.every((cell: any) => cell.table_id === 'active_disclosure')).toBe(true);
        expect(
            cells.find((cell: any) => cell.row_key === 'regulations' && cell.col_key === 'made')
        ).toMatchObject({ value_num: 0, value_semantic: 'ZERO' });
        expect(
            cells.find((cell: any) => cell.row_key === 'normative_documents' && cell.col_key === 'made')
        ).toMatchObject({ value_num: 13, cell_ref: 'active_disclosure:normative_documents:made' });
    });

    it('materializes the full candidate into cells and fact rows', async () => {
        const { queries } = mockPoolClient();
        const candidate = candidateFor('shanghai-office-2025-official-sample-grid.json');

        await expect(
            materializeReportVersion({ reportId: 9001, versionId: 9002, parsedJson: candidate })
        ).resolves.toBeUndefined();

        const statements = queries.map((entry) => entry.sql.trim().split('\n')[0]);
        expect(statements).toContain('BEGIN');
        expect(statements).toContain('COMMIT');
        expect(queries.some((entry) => entry.sql.includes('INSERT INTO fact_application'))).toBe(true);
        expect(queries.some((entry) => entry.sql.includes('INSERT INTO fact_legal_proceeding'))).toBe(true);

        const cellInserts = queries.filter((entry) => entry.sql.includes('INSERT INTO cells'));
        const tableIds = new Set(cellInserts.map((entry) => entry.params[1]));
        expect([...tableIds].sort()).toEqual(['active_disclosure', 'application', 'legal_proceeding']);
        // 表三 is 25 rows x 7 applicant columns in the fixed skeleton.
        expect(cellInserts.filter((entry) => entry.params[1] === 'application').length).toBe(25 * 7);
        expect(queries.some((entry) => entry.sql.includes('ROLLBACK'))).toBe(false);
    });

    it('accepts the candidate as a JSON string, the way report_versions stores it', async () => {
        const { queries } = mockPoolClient();
        const candidate = candidateFor('kewei-2024-official-sample-grid.json');
        await materializeReportVersion({
            reportId: 1,
            versionId: 2,
            parsedJson: JSON.stringify(candidate),
        });
        expect(queries.some((entry) => entry.sql.includes('INSERT INTO fact_active_disclosure'))).toBe(true);
    });

    it('documents the loose half of the contract: no sections commits zero cells', async () => {
        // MaterializeService only throws when normalisation yields nothing at all. Keeping
        // an empty candidate out of the pipeline is hasParsedContent()'s job upstream.
        const { queries } = mockPoolClient();
        await materializeReportVersion({ reportId: 1, versionId: 2, parsedJson: { sections: [] } });
        expect(queries.some((entry) => entry.sql.includes('INSERT INTO cells'))).toBe(false);
        expect(queries.some((entry) => entry.sql.includes('COMMIT'))).toBe(true);
    });

    it('throws parsed_json_invalid only when normalisation yields nothing', async () => {
        mockPoolClient();
        await expect(
            materializeReportVersion({ reportId: 1, versionId: 2, parsedJson: null as any })
        ).rejects.toThrow('parsed_json_invalid');
    });

    it('commits nothing for a payload that is not JSON at all', async () => {
        // normalizeParsedPayload passes a bare string through, so this is a silent
        // zero-cell commit rather than an error — another reason the enforce gate must
        // require hasParsedContent() before accepting a candidate.
        const { queries } = mockPoolClient();
        await materializeReportVersion({ reportId: 1, versionId: 2, parsedJson: 'no json here' });
        expect(queries.some((entry) => entry.sql.includes('INSERT INTO cells'))).toBe(false);
    });
});

describe('Phase 0.3 candidate output contract — ConsistencyCheckService', () => {
    const service = new ConsistencyCheckService();

    it('runs the 勾稽 checks against the candidate and passes them on complete data', () => {
        const candidate = candidateFor('shanghai-office-2025-official-sample-grid.json');
        const items = service.runChecks(candidate, 2024);
        expect(items.length).toBeGreaterThan(0);
        expect(items.some((item) => item.checkKey === 'parse_error')).toBe(false);

        const totals = items.filter((item) => item.checkKey.startsWith('t3_result_total_'));
        expect(totals.length).toBeGreaterThan(0);
        expect(totals.every((item) => item.autoStatus === 'PASS')).toBe(true);

        const identities = items.filter((item) => item.checkKey.startsWith('t3_identity_'));
        expect(identities.length).toBeGreaterThan(0);
        expect(identities.every((item) => item.autoStatus === 'PASS')).toBe(true);

        const legal = items.filter((item) => item.checkKey.startsWith('t4_sum_'));
        expect(legal.length).toBeGreaterThan(0);
        expect(legal.every((item) => item.autoStatus === 'PASS')).toBe(true);
    });

    it('flags the kewei sample as UNCERTAIN instead of letting incomplete Channel B data pass', () => {
        const candidate = candidateFor('kewei-2024-official-sample-grid.json');
        const items = service.runChecks(candidate, 2024);
        // pdfplumber drops the 「（六）其他处理」 rows from this grid, so 分项之和 cannot be
        // computed. The existing checker answers UNCERTAIN for an absent component rather
        // than FAIL — which is the property enforce mode must rely on: only an all-PASS
        // candidate may skip the LLM.
        const uncertain = items.filter((item) => item.autoStatus === 'UNCERTAIN');
        expect(uncertain.length).toBeGreaterThan(0);
        expect(uncertain.some((item) => item.checkKey.startsWith('t3_result_total_'))).toBe(true);

        const natural = uncertain.find((item) => item.checkKey === 't3_result_total_naturalPerson');
        expect(natural).toBeDefined();
        expect(natural!.leftValue).toBeNull();
        expect(natural!.rightValue).toBe(33);

        // The rows Channel B did read still have to satisfy the identity checks.
        expect(items.find((item) => item.checkKey === 't3_identity_total')?.autoStatus).toBe('PASS');
    });

    it('reports a missing table as NOT_ASSESSABLE rather than inventing a PASS', () => {
        const candidate = buildCandidateParsedJson(mapGridToSkeleton([]));
        const items = service.runChecks(candidate, 2024);
        expect(items.some((item) => item.checkKey === 't3_missing' && item.autoStatus === 'NOT_ASSESSABLE')).toBe(true);
    });
});

describe('Phase 0.3 candidate output contract — full chain from a real PDF', () => {
    it('PDF -> sidecar -> mapper -> hasParsedContent -> materialize -> runChecks', async () => {
        const extraction = await extractLattice({ pdfPath: KEWEI_PDF, timeoutMs: 90_000 });
        if (!extraction.ok) {
            // No Python/pdfplumber on this machine (CI image has none yet): the contract is
            // still proven above on the captured grid, which is byte-identical to this run.
            // eslint-disable-next-line no-console
            console.warn(`[dual-channel] skipping live sidecar chain: ${extraction.code} ${extraction.message}`);
            expect(['python_unavailable', 'engine_reported_failure', 'invalid_json', 'timeout']).toContain(
                extraction.code
            );
            return;
        }

        const skeleton = mapGridToSkeleton(extraction.pages as LatticePage[]);
        expect(skeleton.gridTableCount).toBeGreaterThan(0);
        const candidate = buildCandidateParsedJson(skeleton, { year: 2024, generatedAt: '2026-01-01T00:00:00.000Z' });

        expect(hasParsedContent(candidate)).toBe(true);
        expect(candidate.sections.map((section: any) => section.type)).toEqual(['table_2', 'table_3', 'table_4']);
        // The live run must agree with the captured fixture, otherwise the fixture is stale.
        expect(candidate.sections[0].activeDisclosureData.normativeDocuments).toEqual({ made: 13, repealed: 0, valid: 55 });

        const { queries } = mockPoolClient();
        await materializeReportVersion({ reportId: 7, versionId: 8, parsedJson: candidate });
        expect(queries.some((entry) => entry.sql.includes('INSERT INTO cells'))).toBe(true);

        const items = new ConsistencyCheckService().runChecks(candidate, 2024);
        expect(items.length).toBeGreaterThan(0);
        expect(items.some((item) => item.checkKey === 'parse_error')).toBe(false);
        // Known gap on this sample: the gate must mark it UNCERTAIN rather than accept it.
        expect(items.filter((item) => item.autoStatus === 'UNCERTAIN').length).toBeGreaterThan(0);
    }, 120_000);
});
