import pool from '../../config/database-llm';
import { materializeReportVersion } from '../MaterializeService';

export interface MaterializeResult {
    factsCreated: number;
    cellsCreated: number;
    success: boolean;
    error?: string;
}

type VersionRow = {
    report_id: number;
    parsed_json: string | Record<string, any> | null;
};

export class MaterializeService {
    /**
     * Materialize a report version from JSON to relational tables.
     */
    async materializeVersion(versionId: number): Promise<MaterializeResult> {
        try {
            const version = await this.loadVersion(versionId);
            if (!version) {
                throw new Error(`Version ${versionId} not found`);
            }

            if (!version.parsed_json) {
                throw new Error('parsed_json is empty, cannot materialize');
            }

            await materializeReportVersion({
                reportId: version.report_id,
                versionId,
                parsedJson: version.parsed_json,
            });

            const counts = await this.loadCounts(versionId);
            return {
                factsCreated: counts.facts,
                cellsCreated: counts.cells,
                success: true,
            };
        } catch (error: any) {
            console.error(`[Materialize] Error materializing version ${versionId}:`, error);
            return { factsCreated: 0, cellsCreated: 0, success: false, error: error.message };
        }
    }

    private async loadVersion(versionId: number): Promise<VersionRow | null> {
        const result = await pool.query(
            `SELECT rv.parsed_json, r.id as report_id
             FROM report_versions rv
             JOIN reports r ON r.id = rv.report_id
             WHERE rv.id = $1
             LIMIT 1`,
            [versionId]
        );

        return (result.rows?.[0] as VersionRow) || null;
    }

    private async loadCounts(versionId: number): Promise<{ facts: number; cells: number }> {
        const cellsResult = await pool.query(
            `SELECT COUNT(*) as count FROM cells WHERE version_id = $1`,
            [versionId]
        );

        const activeResult = await pool.query(
            `SELECT COUNT(*) as count FROM fact_active_disclosure WHERE version_id = $1`,
            [versionId]
        );
        const applicationResult = await pool.query(
            `SELECT COUNT(*) as count FROM fact_application WHERE version_id = $1`,
            [versionId]
        );
        const legalResult = await pool.query(
            `SELECT COUNT(*) as count FROM fact_legal_proceeding WHERE version_id = $1`,
            [versionId]
        );

        const cellsCount = Number(cellsResult.rows?.[0]?.count || 0);
        const factsCount =
            Number(activeResult.rows?.[0]?.count || 0) +
            Number(applicationResult.rows?.[0]?.count || 0) +
            Number(legalResult.rows?.[0]?.count || 0);

        return { facts: factsCount, cells: cellsCount };
    }
}

export const materializeService = new MaterializeService();
