
import sqlite3 from 'sqlite3';
import { Pool } from 'pg';
import path from 'path';

// Config
const SQLITE_DB_PATH = path.resolve(__dirname, '../../data/llm_ingestion.db');
const PG_CONNECTION_STRING = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/gov_report_diff';

console.log(`Source SQLite: ${SQLITE_DB_PATH}`);
console.log(`Dest Postgres: ${PG_CONNECTION_STRING}`);

// Setup connections
const sqlite = new sqlite3.Database(SQLITE_DB_PATH, sqlite3.OPEN_READONLY);
const pgPool = new Pool({
    connectionString: PG_CONNECTION_STRING,
});

// Helper to query SQLite
function getSqliteData(table: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        sqlite.all(`SELECT * FROM ${table}`, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Helper to sanitize value for PG
function sanitizeValue(val: any, colName?: string): any {
    if (val === null || val === undefined) return null;

    // Handle Booleans (SQLite 0/1 -> PG boolean)
    if (typeof val === 'number' && (val === 0 || val === 1)) {
        // Heuristic: check column names commonly associated with booleans
        // Or just let PG cast 0/1 if the column is int? No, PG is strict.
        // We need schema info to do this perfectly, or manual mapping.
        // For now, let's keep it as is, unless we know specific columns.
    }

    // Common boolean columns in this project
    const boolCols = ['is_active'];
    if (colName && boolCols.includes(colName)) {
        return val === 1;
    }

    // Handle JSON fields (SQLite string -> PG object/string)
    // PG node driver automatically stringifies objects for JSONB, but if we give a string, it uses it?
    // Let's pass the object if valid JSON string.
    if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
        try {
            // Is it a JSON column?
            const jsonCols = ['parsed_json', 'diff_json', 'output_json', 'summary_json', 'evidence_json', 'content_json', 'permissions', 'data_scope'];
            if (colName && jsonCols.includes(colName)) {
                return val; // Pass string directly to PG, let it parse? Or parse here?
                // PG driver expects string for JSON/JSONB or object?
                // Actually, simply passing the string works if it's valid JSON.
            }
        } catch (e) { }
    }

    return val;
}

// Map SQLite 0/1 to Boolean for specific columns
const BOOLEAN_COLUMNS: Record<string, string[]> = {
    'report_versions': ['is_active'],
    'reports': ['is_active'], // if exists
    'metric_dictionary': ['aggregatable'],
};

// JSON Columns
const JSON_COLUMNS: Record<string, string[]> = {
    'report_versions': ['parsed_json'],
    'comparison_results': ['diff_json'],
    'report_version_parses': ['output_json'],
    'report_consistency_runs': ['summary_json'],
    'report_consistency_items': ['evidence_json'],
    'notifications': ['content_json'],
    'admin_users': ['permissions', 'data_scope']
};

async function migrateTable(tableName: string) {
    console.log(`Migrating ${tableName}...`);
    try {
        const rows = await getSqliteData(tableName);
        console.log(`  Found ${rows.length} rows in SQLite.`);

        if (rows.length === 0) return;

        const cols = Object.keys(rows[0]);

        const client = await pgPool.connect();
        try {
            await client.query('BEGIN');

            // Disable triggers/constraints momentarily?
            // SET session_replication_role = 'replica';
            await client.query("SET session_replication_role = 'replica';");

            for (const row of rows) {
                const values = cols.map(col => {
                    let val = row[col];

                    // Boolean conversion
                    if (BOOLEAN_COLUMNS[tableName]?.includes(col)) {
                        val = (val === 1);
                    }

                    // Handle null updated_at
                    if (col === 'updated_at' && (val === null || val === undefined)) {
                        if (row['created_at']) {
                            val = row['created_at'];
                        } else {
                            val = new Date().toISOString();
                        }
                    }

                    // JSON conversion handled automatically?
                    // Sometimes SQLite stores 'null' string?

                    return val;
                });

                const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
                const query = `INSERT INTO ${tableName} ("${cols.join('", "')}") VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

                await client.query(query, values);
            }

            await client.query("SET session_replication_role = 'origin';");
            await client.query('COMMIT');
            // Reset sequence
            try {
                // Assume 'id' is serial
                if (cols.includes('id')) {
                    await client.query(`SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), (SELECT MAX(id) FROM ${tableName}));`);
                }
            } catch (e) { console.log(`  Note: Could not reset sequence for ${tableName} (might not have serial id)`); }

            console.log(`  Successfully migrated ${tableName}.`);
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(`  Error migrating ${tableName}:`, err);
            throw err;
        } finally {
            client.release();
        }

    } catch (err) {
        if ((err as any).message?.includes('no such table')) {
            console.log(`  Table ${tableName} does not exist in SQLite (skipping).`);
        } else {
            console.error(`  Failed to read ${tableName} from SQLite:`, err);
        }
    }
}

async function main() {
    try {
        // Tables in dependency order
        // Note: With session_replication_role = 'replica', order matters less for FKs, but good practice.
        const tables = [
            'admin_users',
            'regions',
            'ingestion_batches',
            'reports',
            'report_versions',
            'report_version_parses',
            'report_consistency_runs',
            'report_consistency_items',
            'comparisons',
            'comparison_results',
            'jobs',
            'notifications',
            'metric_dictionary'
        ];

        // Clean slate in PG? 
        // Optional: truncate first.
        const client = await pgPool.connect();
        console.log('Clearing existing data in Postgres...');
        await client.query("SET session_replication_role = 'replica';");
        for (const t of tables.reverse()) { // Delete children first
            await client.query(`TRUNCATE TABLE ${t} CASCADE`).catch(() => { });
        }
        await client.query("SET session_replication_role = 'origin';");
        client.release();

        for (const table of tables.reverse()) { // Revert back to proper order
            await migrateTable(table);
        }

        console.log('Migration Complete.');
        process.exit(0);
    } catch (e) {
        console.error('Migration Failed:', e);
        process.exit(1);
    }
}

main();
