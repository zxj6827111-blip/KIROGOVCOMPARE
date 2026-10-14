/**
 * Phase 1 shadow statistics — read-only aggregation over parse_runs.dual_channel_json.
 *
 * The plan requires evidence before enforce: agree ratio, conflict ratio, channel_error
 * ratio, and how often Channel B was better than the AI result. This script does not write
 * anything; run it after a batch of parses with PDF_DUAL_CHANNEL_MODE=shadow.
 *
 *   npx ts-node scripts/pdf-shadow-stats.ts --limit=200
 *   npx ts-node scripts/pdf-shadow-stats.ts --json
 */
import '../src/config/database-llm';
import pool from '../src/config/database-llm';

interface Args {
    limit: number;
    since: string | null;
    json: boolean;
}

function parseArgs(argv: string[]): Args {
    const args: Args = { limit: 0, since: null, json: false };
    for (const raw of argv.slice(2)) {
        const [key, value = ''] = raw.replace(/^--/, '').split('=');
        if (key === 'limit') args.limit = Math.max(0, Number(value) || 0);
        else if (key === 'since') args.since = value || null;
        else if (key === 'json') args.json = true;
    }
    return args;
}

const VERDICTS = ['agree', 'agree_b_superset', 'a_gap', 'conflict', 'no_candidate', 'a_unavailable', 'channel_error'];

async function main(): Promise<number> {
    const args = parseArgs(process.argv);

    const filters: string[] = ["dual_channel_json IS NOT NULL"];
    const params: any[] = [];
    if (args.since) {
        params.push(args.since);
        filters.push(`created_at >= $${params.length}::timestamptz`);
    }
    if (args.limit > 0) {
        params.push(args.limit);
    }
    const limitClause = args.limit > 0 ? `LIMIT $${params.length}` : 'LIMIT 5000';

    const result = await pool.query(
        `SELECT id, report_version_id, status, dual_channel_json
         FROM parse_runs
         WHERE ${filters.join(' AND ')}
         ORDER BY id DESC
         ${limitClause}`,
        params
    );

    const rows = result.rows.map((row) => ({ ...row, dual: row.dual_channel_json || {} }));
    const byVerdict: Record<string, number> = {};
    for (const verdict of VERDICTS) byVerdict[verdict] = 0;

    let confidenceSum = 0;
    let confidenceN = 0;
    let table3RowSum = 0;
    let table3RowN = 0;
    let sidecarMsSum = 0;
    let sidecarMsN = 0;
    const consistency = { pass: 0, fail: 0, uncertain: 0, notAssessable: 0 };
    const conflictRefs = new Map<string, number>();
    const errorCodes = new Map<string, number>();
    let candidateBetter = 0;
    let aiBetter = 0;

    for (const row of rows) {
        const verdict = String(row.dual.verdict || 'unknown');
        byVerdict[verdict] = (byVerdict[verdict] || 0) + 1;

        if (typeof row.dual.confidence === 'number' && verdict !== 'channel_error') {
            confidenceSum += row.dual.confidence;
            confidenceN += 1;
        }
        if (row.dual.coverage?.table3RowsFilled != null) {
            table3RowSum += row.dual.coverage.table3RowsFilled;
            table3RowN += 1;
        }
        if (typeof row.dual.sidecarMs === 'number') {
            sidecarMsSum += row.dual.sidecarMs;
            sidecarMsN += 1;
        }
        for (const key of ['pass', 'fail', 'uncertain', 'notAssessable'] as const) {
            consistency[key] += Number(row.dual.consistency?.[key] || 0);
        }
        for (const diff of row.dual.conflicts || []) {
            if (diff.status === 'conflict') {
                conflictRefs.set(diff.ref, (conflictRefs.get(diff.ref) || 0) + 1);
            }
        }
        if (row.dual.sidecarError?.code) {
            errorCodes.set(row.dual.sidecarError.code, (errorCodes.get(row.dual.sidecarError.code) || 0) + 1);
        }
        // "candidate better than AI" is only claimed when the two never disagree and B
        // still filled figures A left blank; a_gap is the mirror image.
        if (verdict === 'agree_b_superset') candidateBetter += 1;
        if (verdict === 'a_gap') aiBetter += 1;
    }

    const comparable = rows.length;
    const report = {
        runs: comparable,
        byVerdict,
        agreeRatio: comparable ? Number((((byVerdict.agree || 0) + (byVerdict.agree_b_superset || 0)) / comparable).toFixed(4)) : null,
        conflictRatio: comparable ? Number(((byVerdict.conflict || 0) / comparable).toFixed(4)) : null,
        channelErrorRatio: comparable ? Number(((byVerdict.channel_error || 0) / comparable).toFixed(4)) : null,
        avgConfidence: confidenceN ? Number((confidenceSum / confidenceN).toFixed(4)) : null,
        avgTable3RowsFilled: table3RowN ? Number((table3RowSum / table3RowN).toFixed(2)) : null,
        avgSidecarMs: sidecarMsN ? Math.round(sidecarMsSum / sidecarMsN) : null,
        consistencyTotals: consistency,
        candidateBetterThanAi: candidateBetter,
        aiBetterThanCandidate: aiBetter,
        topConflictCells: [...conflictRefs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
        sidecarErrors: [...errorCodes.entries()].sort((a, b) => b[1] - a[1]),
    };

    if (args.json) {
        console.log(JSON.stringify(report, null, 2));
        return 0;
    }

    console.log(`PDF dual-channel shadow statistics over ${report.runs} parse_runs`);
    if (report.runs === 0) {
        console.log('No shadow records yet. Set PDF_DUAL_CHANNEL_MODE=shadow, restart the worker, then re-parse.');
        return 0;
    }
    console.table(byVerdict);
    console.log(`  agree ratio            : ${report.agreeRatio}`);
    console.log(`  conflict ratio         : ${report.conflictRatio}`);
    console.log(`  channel_error ratio    : ${report.channelErrorRatio}`);
    console.log(`  avg cell confidence    : ${report.avgConfidence}`);
    console.log(`  avg 表三 rows read     : ${report.avgTable3RowsFilled} / 25`);
    console.log(`  avg sidecar wall time  : ${report.avgSidecarMs} ms`);
    console.log(`  candidate better       : ${report.candidateBetterThanAi}`);
    console.log(`  AI better (B has gaps) : ${report.aiBetterThanCandidate}`);
    console.log('  consistency totals     :', consistency);
    if (report.topConflictCells.length) {
        console.log('  most-conflicted cells  :');
        for (const [ref, count] of report.topConflictCells) console.log(`     ${String(count).padStart(5)}  ${ref}`);
    }
    if (report.sidecarErrors.length) {
        console.log('  sidecar errors         :', report.sidecarErrors);
    }
    return 0;
}

main()
    .then((code) => pool.end().then(() => process.exit(code)))
    .catch(async (error) => {
        console.error('[pdf-shadow-stats] failed:', error?.message || error);
        await pool.end().catch(() => {});
        process.exit(1);
    });
