const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// 配置
// 优先使用环境变量；否则默认使用当前项目实际的 SQLite 路径 data/llm_ingestion.db
// 若旧版路径 data/gov-reports-llm.db 仍存在，则作为向后兼容的后备。
const explicitSqlitePath = (process.env.SQLITE_DB_PATH || '').trim();
const defaultSqlitePath = path.join(__dirname, '../data/llm_ingestion.db');
const legacySqlitePath = path.join(__dirname, '../data/gov-reports-llm.db');
const SQLITE_DB_PATH = explicitSqlitePath || (fs.existsSync(defaultSqlitePath) ? defaultSqlitePath : legacySqlitePath);
const BATCH_SIZE = 100;

// PostgreSQL 连接
const pgPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'gov_report_diff',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
});

async function main() {
    console.log('🚀 开始从 SQLite 迁移到 PostgreSQL...');
    console.log(`📂 SQLite 路径: '${SQLITE_DB_PATH}'`);
    console.log(`🐘 Postgres 数据库: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);

    if (!fs.existsSync(SQLITE_DB_PATH)) {
        console.error(`❌ 未在 '${SQLITE_DB_PATH}' 找到 SQLite 文件`);
        try {
            const dir = path.dirname(SQLITE_DB_PATH);
            console.log(`\n🔍 目录 '${dir}' 的内容:`);
            if (fs.existsSync(dir)) {
                console.log(fs.readdirSync(dir).join('\n'));
            } else {
                console.log(`(目录 '${dir}' 也不存在)`);
            }
        } catch(e) { console.log('Cannot list directory:', e.message); }
        
        console.log('\n提示：上传本地 .db 文件到服务器，并更新 SQLITE_DB_PATH 环境变量。');
        process.exit(1);
    }

    const sqliteDb = new sqlite3.Database(SQLITE_DB_PATH, sqlite3.OPEN_READONLY);
    
    // 🔗 获取一个持久的连接，用于整个迁移过程
    // IMPORTANT: 必须使用同一个 client，否则 SET session_replication_role 不会生效！
    const client = await pgPool.connect();

    try {
        // 1. 获取表列表
        const tablesRaw = await new Promise((resolve, reject) => {
            sqliteDb.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(r => r.name));
            });
        });

        const TABLE_ORDER = [
            'regions',
            'reports',
            'report_versions',
            'comparisons',
            'comparison_results',
            'jobs',
            'report_version_parses',
            'report_consistency_runs',
            'report_consistency_items',
            'notifications'
        ];

        const tables = tablesRaw.sort((a, b) => {
            const idxA = TABLE_ORDER.indexOf(a);
            const idxB = TABLE_ORDER.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        });

        console.log(`📋 Found ${tables.length} tables (Sorted): ${tables.join(', ')}`);

        // ⚠️ 禁用外键触发器 (当前 Session 生效)
        console.log('🔧 禁用外键约束检查 (session_replication_role = replica)...');
        await client.query('SET session_replication_role = replica;');

        // 2. 清空 Postgres 中的表
        if (process.argv.includes('--clean')) {
            console.log('🧹 正在清理 PostgreSQL 现有表...');
            const tablesToClean = [...tables].reverse();
            for (const table of tablesToClean) {
                try {
                    await client.query(`TRUNCATE TABLE "${table}"`);
                    console.log(`   - 已清空 ${table}`);
                } catch (e) {
                    console.warn(`   - 清空 ${table} 警告: ${e.message}`);
                }
            }
        }

        // 3. 迁移数据
        for (const table of tables) {
            console.log(`\n📦 迁移表: ${table}`);
            
            const rows = await new Promise((resolve, reject) => {
                sqliteDb.all(`SELECT * FROM "${table}"`, [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });

            if (rows.length === 0) {
                console.log(`   - 0 行，跳过。`);
                continue;
            }

            console.log(`   - 找到 ${rows.length} 行。`);

            let inserted = 0;
            for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                const batch = rows.slice(i, i + BATCH_SIZE);
                
                const keys = Object.keys(batch[0]);
                const columns = keys.map(k => `"${k}"`).join(', ');
                const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');
                
                // 使用同一个 client 开启事务
                try {
                    await client.query('BEGIN');
                    for (const row of batch) {
                        const values = keys.map(k => row[k]);
                        
                        // ON CONFLICT DO NOTHING 避免唯一性约束冲突 (如 id 或 code 重复)
                        // 注意：如果 id 被跳过，后续表引用该 id 会依赖 SET session_replication_role 来忽略 FK 错误
                        const queryText = `INSERT INTO "${table}" (${columns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
                        await client.query(queryText, values);
                    }
                    await client.query('COMMIT');
                    inserted += batch.length;
                    process.stdout.write(`\r   - 进度: ${inserted}/${rows.length}`);
                } catch (e) {
                    await client.query('ROLLBACK');
                    console.error(`\n   ❌ ${table} 批处理失败:`, e.message);
                    throw e; // 直接抛出，停止后续可能更混乱的迁移
                }
            }
            console.log(`\n   ✅ ${table} 完成。`);
        }

        console.log('\n🎉 迁移成功完成！');

    } catch (err) {
        console.error('\n❌ 迁移失败:', err);
    } finally {
        // 恢复设置 (虽然连接释放后通常重置，或者是新连接，但显式恢复是好习惯)
        try {
             await client.query('SET session_replication_role = DEFAULT;');
        } catch(e) {}
        
        client.release(); // 释放连接回池
        sqliteDb.close();
        await pgPool.end(); // 关闭池
    }
}

main();
