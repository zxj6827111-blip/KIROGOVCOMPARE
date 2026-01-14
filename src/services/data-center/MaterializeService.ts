
import pool from '../../config/database-llm';

export interface MaterializeResult {
    factsCreated: number;
    cellsCreated: number;
    success: boolean;
    error?: string;
}

export class MaterializeService {
    /**
     * Materialize a report version from JSON to relational tables.
     */
    async materializeVersion(versionId: number): Promise<MaterializeResult> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Get version and report info
            const versionResult = await client.query(
                'SELECT rv.parsed_json, r.id as report_id FROM report_versions rv JOIN reports r ON r.id = rv.report_id WHERE rv.id = $1',
                [versionId]
            );

            if (versionResult.rows.length === 0) {
                throw new Error(`Version ${versionId} not found`);
            }

            const { parsed_json, report_id } = versionResult.rows[0];
            const data = typeof parsed_json === 'string' ? JSON.parse(parsed_json) : parsed_json;

            if (!data || !data.sections) {
                console.warn(`[Materialize] No sections found in version ${versionId}`);
                await client.query('ROLLBACK');
                return { factsCreated: 0, cellsCreated: 0, success: true };
            }

            // 2. Clear existing materialization for this version to ensure idempotency
            await client.query('DELETE FROM cells WHERE version_id = $1', [versionId]);
            await client.query('DELETE FROM fact_active_disclosure WHERE version_id = $1', [versionId]);
            await client.query('DELETE FROM fact_application WHERE version_id = $1', [versionId]);
            await client.query('DELETE FROM fact_legal_proceeding WHERE version_id = $1', [versionId]);

            let factsCount = 0;
            let cellsCount = 0;

            // 3. Process sections
            for (const section of data.sections) {
                const tableType = section.type;
                const rows = section.rows || [];

                // Save cells for all table types
                if (['table_2', 'table_3', 'table_4'].includes(tableType)) {
                    const created = await this.saveCells(client, versionId, section);
                    cellsCount += created;
                }

                // Map facts based on table type
                if (tableType === 'table_2') {
                    factsCount += await this.mapActiveDisclosure(client, report_id, versionId, rows);
                } else if (tableType === 'table_3') {
                    factsCount += await this.mapApplication(client, report_id, versionId, rows);
                } else if (tableType === 'table_4') {
                    factsCount += await this.mapLegalProceeding(client, report_id, versionId, rows);
                }
            }

            await client.query('COMMIT');
            return { factsCreated: factsCount, cellsCreated: cellsCount, success: true };
        } catch (error: any) {
            await client.query('ROLLBACK');
            console.error(`[Materialize] Error materializing version ${versionId}:`, error);
            return { factsCreated: 0, cellsCreated: 0, success: false, error: error.message };
        } finally {
            client.release();
        }
    }

    private async saveCells(client: any, versionId: number, section: any): Promise<number> {
        const rows = section.rows || [];
        const tableId = section.title || section.type;
        let count = 0;

        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            const rowKey = row.name || `row_${r}`;

            for (const colKey in row) {
                if (colKey === 'name' || colKey === 'id') continue;

                const val = row[colKey];
                const cellRef = `${tableId}:${rowKey}:${colKey}`;
                const hasValue = val !== null && val !== undefined && String(val).trim() !== '';

                const semantic = this.getSemantic(val);

                await client.query(
                    `INSERT INTO cells (version_id, table_id, row_key, col_key, cell_ref, value_raw, value_num, value_semantic)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT(version_id, cell_ref) DO UPDATE SET
             value_raw = excluded.value_raw,
             value_num = excluded.value_num,
             value_semantic = excluded.value_semantic`,
                    [
                        versionId,
                        tableId,
                        rowKey,
                        colKey,
                        cellRef,
                        hasValue ? String(val) : null,
                        typeof val === 'number' ? val : (this.isNumeric(val) ? parseFloat(val) : null),
                        semantic
                    ]
                );
                count++;
            }
        }
        return count;
    }

    private getSemantic(val: any): string {
        if (val === null || val === undefined || String(val).trim() === '') return 'EMPTY';
        if (val === 0 || val === '0' || val === '0.00' || val === '0.0') return 'ZERO';
        if (val === '-' || val === '/' || val === '无' || val === '不适用' || val === 'N/A') return 'NA';
        if (this.isNumeric(val)) return 'NUMERIC';
        return 'TEXT';
    }

    private isNumeric(val: any): boolean {
        if (typeof val === 'number') return true;
        if (typeof val !== 'string') return false;
        return !isNaN(parseFloat(val)) && isFinite(Number(val));
    }

    private async mapActiveDisclosure(client: any, reportId: number, versionId: number, rows: any[]): Promise<number> {
        let count = 0;
        for (const row of rows) {
            if (!row.name) continue;

            const made = this.parseSafeInt(row['本年制发数量'] || row['本年制发数']);
            const repealed = this.parseSafeInt(row['本年废止数量'] || row['本年废止数']);
            const valid = this.parseSafeInt(row['现行有效数量'] || row['现行有效数']);

            if (made !== null || repealed !== null || valid !== null) {
                await client.query(
                    `INSERT INTO fact_active_disclosure (report_id, version_id, category, made_count, repealed_count, valid_count)
           VALUES ($1, $2, $3, $4, $5, $6)`,
                    [reportId, versionId, row.name, made, repealed, valid]
                );
                count++;
            }
        }
        return count;
    }

    private async mapApplication(client: any, reportId: number, versionId: number, rows: any[]): Promise<number> {
        let count = 0;
        // For Table 3, rows are usually result types (Item) and columns are applicant types
        // This mapping depends on the specific JSON structure. 
        // Usually: { name: "予以公开", "自然人": 10, "法人": 2 }
        for (const row of rows) {
            if (!row.name) continue;

            for (const col in row) {
                if (col === 'name' || col === 'id') continue;
                const val = this.parseSafeInt(row[col]);
                if (val !== null) {
                    await client.query(
                        `INSERT INTO fact_application (report_id, version_id, applicant_type, response_type, count)
             VALUES ($1, $2, $3, $4, $5)`,
                        [reportId, versionId, col, row.name, val]
                    );
                    count++;
                }
            }
        }
        return count;
    }

    private async mapLegalProceeding(client: any, reportId: number, versionId: number, rows: any[]): Promise<number> {
        let count = 0;
        // For Table 4, rows are case types, columns are results
        for (const row of rows) {
            if (!row.name) continue;
            for (const col in row) {
                if (col === 'name' || col === 'id') continue;
                const val = this.parseSafeInt(row[col]);
                if (val !== null) {
                    await client.query(
                        `INSERT INTO fact_legal_proceeding (report_id, version_id, case_type, result_type, count)
             VALUES ($1, $2, $3, $4, $5)`,
                        [reportId, versionId, row.name, col, val]
                    );
                    count++;
                }
            }
        }
        return count;
    }

    private parseSafeInt(val: any): number | null {
        if (val === null || val === undefined || val === '') return null;
        if (typeof val === 'number') return Math.floor(val);
        const parsed = parseInt(String(val).replace(/[,，]/g, ''), 10);
        return isNaN(parsed) ? null : parsed;
    }
}

export const materializeService = new MaterializeService();
