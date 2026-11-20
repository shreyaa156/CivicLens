/**
 * Copy CivicLens data from the SQLite database into MySQL — safely.
 *
 *  - The SQLite file is opened READ-ONLY and is never modified or deleted.
 *  - MySQL tables are created if missing (same schema the app uses).
 *  - Rows keep their original ids so links between reports, images, duplicates and agent runs stay intact.
 *  - Re-runnable: rows whose id already exists in MySQL are skipped (INSERT IGNORE).
 *  - Dry run by default: shows what would be copied. Add --apply to write.
 *
 * Usage (MySQL credentials come from DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD):
 *   node scripts/migrate-sqlite-to-mysql.js                       # dry run, default SQLite path
 *   node scripts/migrate-sqlite-to-mysql.js --apply               # copy data
 *   node scripts/migrate-sqlite-to-mysql.js --sqlite=path/to.db --apply
 *
 * Uploaded photos are files, not database rows: copy server/data/uploads/* to the production UPLOAD_DIR.
 */
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import mysql from 'mysql2/promise';
import { config } from '../src/config/index.js';
import { mysqlConfigFromEnv } from '../src/db/index.js';
import { MYSQL_SCHEMA, TABLES } from '../src/db/schema.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const sqlitePath = (args.find((a) => a.startsWith('--sqlite=')) || '').slice(9) || config.databasePath;

if (!fs.existsSync(sqlitePath)) {
  console.error(`SQLite database not found: ${sqlitePath}`);
  process.exit(1);
}

let mysqlConfig;
try {
  mysqlConfig = mysqlConfigFromEnv();
} catch (err) {
  console.error(`${err.message}. Set DB_HOST, DB_PORT, DB_NAME, DB_USER and DB_PASSWORD first.`);
  process.exit(1);
}

const source = new DatabaseSync(sqlitePath, { readOnly: true });
const conn = await mysql.createConnection({ ...mysqlConfig, namedPlaceholders: false });
console.log(`Source (read-only): ${sqlitePath}`);
console.log(`Target: MySQL ${mysqlConfig.database} on ${mysqlConfig.host}:${mysqlConfig.port}`);
console.log(apply ? 'Mode: APPLY (copying data)\n' : 'Mode: DRY RUN (nothing is written; add --apply to copy)\n');

try {
  for (const ddl of MYSQL_SCHEMA) await conn.query(ddl);
  const now = new Date().toISOString();
  const totals = [];

  for (const table of TABLES) {
    const exists = source.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    if (!exists) {
      totals.push({ table, source: 0, inserted: 0, skipped: 0 });
      continue;
    }
    const rows = source.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    const [targetCols] = await conn.query(`SHOW COLUMNS FROM ${table}`);
    const targetNames = new Set(targetCols.map((c) => c.Field));
    let inserted = 0;
    if (apply && rows.length) {
      await conn.beginTransaction();
      try {
        for (const row of rows) {
          const r = { ...row };
          // Fill values the MySQL schema requires but old SQLite rows may lack.
          if (targetNames.has('created_at') && !r.created_at) r.created_at = now;
          if (table === 'reports') {
            r.updated_at = r.updated_at || r.created_at || now;
            r.review_reasons = r.review_reasons ?? '[]';
            r.citizen_description = r.citizen_description ?? '';
          }
          if (table === 'contact_messages') r.delivery_status = r.delivery_status || 'stored';
          const cols = Object.keys(r).filter((c) => targetNames.has(c));
          const [res] = await conn.query(`INSERT IGNORE INTO ${table} (${cols.join(', ')}) VALUES (?)`, [cols.map((c) => r[c])]);
          inserted += res.affectedRows;
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw new Error(`${table}: ${err.message}`);
      }
    }
    totals.push({ table, source: rows.length, inserted: apply ? inserted : '-', skipped: apply ? rows.length - inserted : '-' });
  }
  console.table(totals);
  console.log(apply ? '\nDone. The SQLite file was not modified.' : '\nDry run complete. Re-run with --apply to copy the data.');
} catch (err) {
  console.error(`\nMigration failed: ${err.message}\nNothing in the SQLite file was changed.`);
  process.exitCode = 1;
} finally {
  await conn.end();
  source.close();
}
