const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PG_PATH = path.join(ROOT, 'docs', 'schema_pg.json');
const SQLITE_PATH = path.join(ROOT, 'docs', 'schema_sqlite.json');

function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function sortUnique(list) {
  return (list || [])
    .map((cols) => cols.slice().sort().join('|'))
    .sort();
}

function normalizeChecks(checks) {
  return (checks || []).map((c) => c.trim()).filter(Boolean).sort();
}

function compareSchemas(pg, sqlite) {
  const errors = [];
  const pgTables = Object.keys(pg.tables || {}).sort();
  const sqliteTables = Object.keys(sqlite.tables || {}).sort();

  if (pgTables.join(',') !== sqliteTables.join(',')) {
    errors.push(`Table sets differ: pg=[${pgTables.join(', ')}] sqlite=[${sqliteTables.join(', ')}]`);
  }

  const allTables = new Set([...pgTables, ...sqliteTables]);

  allTables.forEach((tableName) => {
    const pgTable = pg.tables?.[tableName];
    const sqliteTable = sqlite.tables?.[tableName];

    if (!pgTable || !sqliteTable) {
      return;
    }

    const pgCols = (pgTable.columns || []).map((col) => col.name);
    const sqliteCols = (sqliteTable.columns || []).map((col) => col.name);

    const pgColSet = new Set(pgCols);
    const sqliteColSet = new Set(sqliteCols);

    const missingInSqlite = pgCols.filter((col) => !sqliteColSet.has(col));
    const missingInPg = sqliteCols.filter((col) => !pgColSet.has(col));

    if (missingInSqlite.length > 0 || missingInPg.length > 0) {
      errors.push(`Table ${tableName} column mismatch: missingInSqlite=[${missingInSqlite.join(', ')}] missingInPg=[${missingInPg.join(', ')}]`);
    }

    const pgColumnMap = Object.fromEntries((pgTable.columns || []).map((col) => [col.name, col]));
    const sqliteColumnMap = Object.fromEntries((sqliteTable.columns || []).map((col) => [col.name, col]));

    pgCols.forEach((colName) => {
      const pgCol = pgColumnMap[colName];
      const sqliteCol = sqliteColumnMap[colName];
      if (!pgCol || !sqliteCol) {
        return;
      }

      if (Boolean(pgCol.nullable) !== Boolean(sqliteCol.nullable)) {
        errors.push(`Table ${tableName} column ${colName} nullable mismatch: pg=${pgCol.nullable} sqlite=${sqliteCol.nullable}`);
      }

      const pgChecks = normalizeChecks(pgCol.checks);
      const sqliteChecks = normalizeChecks(sqliteCol.checks);
      if (pgChecks.join('|') !== sqliteChecks.join('|')) {
        errors.push(`Table ${tableName} column ${colName} check mismatch: pg=[${pgChecks.join(', ')}] sqlite=[${sqliteChecks.join(', ')}]`);
      }
    });

    const pgUnique = sortUnique(pgTable.unique_constraints);
    const sqliteUnique = sortUnique(sqliteTable.unique_constraints);
    if (pgUnique.join('|') !== sqliteUnique.join('|')) {
      errors.push(`Table ${tableName} unique constraints mismatch: pg=[${pgUnique.join(', ')}] sqlite=[${sqliteUnique.join(', ')}]`);
    }
  });

  return errors;
}

function main() {
  if (!fs.existsSync(PG_PATH) || !fs.existsSync(SQLITE_PATH)) {
    console.error('[schema-compare] Missing schema snapshot files.');
    process.exit(1);
  }

  const pg = loadJson(PG_PATH);
  const sqlite = loadJson(SQLITE_PATH);

  const errors = compareSchemas(pg, sqlite);

  if (errors.length > 0) {
    console.error('[schema-compare] Schema semantic comparison failed:');
    errors.forEach((err) => console.error(`- ${err}`));
    process.exit(1);
  }

  console.log('[schema-compare] Schema semantic comparison passed');
}

main();
