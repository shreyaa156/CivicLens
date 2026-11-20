/**
 * Database access layer (async) with two drivers:
 *  - MySQL  (production, e.g. GoDaddy Hosted MySQL) when DB_HOST is set: mysql2/promise connection pool.
 *  - SQLite (local development and automated tests) otherwise: Node's built-in node:sqlite.
 * Override with DB_CLIENT=mysql|sqlite.
 *
 * API: all(sql, params) · get(sql, params) · run(sql, params) → { insertId, changes } · transaction(fn)
 * Params are either an object for :named placeholders or an array for ? placeholders.
 * SQL used by the models is written to run unchanged on both databases.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from '../config/index.js';
import { SQLITE_SCHEMA, MYSQL_SCHEMA } from './schema.js';

let driver = null; // { name, all, get, run, transaction, close }
let initPromise = null;
const txStore = new AsyncLocalStorage();

export const nowIso = () => new Date().toISOString();

/** Normalise params: undefined → null, booleans → 0/1. */
export function clean(params) {
  if (Array.isArray(params)) return params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
  const out = {};
  for (const [k, v] of Object.entries(params || {})) out[k] = v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v;
  return out;
}

export function resolveClient() {
  const forced = (process.env.DB_CLIENT || '').toLowerCase();
  if (forced === 'mysql' || forced === 'sqlite') return forced;
  return process.env.DB_HOST ? 'mysql' : 'sqlite';
}

// ---------------------------------------------------------------- SQLite
async function createSqliteDriver() {
  const { DatabaseSync } = await import('node:sqlite');
  const dbPath = config.databasePath;
  const target = dbPath === ':memory:' || dbPath.endsWith(':memory:') ? ':memory:' : dbPath;
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SQLITE_SCHEMA);
  const cols = db.prepare('PRAGMA table_info(contact_messages)').all().map((c) => c.name);
  if (!cols.includes('read_at')) db.exec('ALTER TABLE contact_messages ADD COLUMN read_at TEXT');

  const exec = (sql, params, mode) => {
    const stmt = db.prepare(sql);
    const p = clean(params);
    const args = Array.isArray(p) ? p : [p];
    if (mode === 'all') return stmt.all(...args).map((r) => ({ ...r }));
    if (mode === 'get') {
      const row = stmt.get(...args);
      return row ? { ...row } : undefined;
    }
    const info = stmt.run(...args);
    return { insertId: Number(info.lastInsertRowid), changes: Number(info.changes) };
  };
  return {
    name: 'sqlite',
    all: async (sql, params) => exec(sql, params, 'all'),
    get: async (sql, params) => exec(sql, params, 'get'),
    run: async (sql, params) => exec(sql, params, 'run'),
    async transaction(fn) {
      db.exec('BEGIN');
      try {
        const result = await fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    raw: db,
    close: async () => db.close(),
  };
}

// ---------------------------------------------------------------- MySQL
export function mysqlConfigFromEnv(env = process.env) {
  const missing = ['DB_HOST', 'DB_NAME', 'DB_USER'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`MySQL configuration incomplete: missing ${missing.join(', ')}`);
  return {
    host: env.DB_HOST,
    port: Number(env.DB_PORT) || 3306,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD || '',
    connectionLimit: Number(env.DB_POOL_SIZE) || 10,
    waitForConnections: true,
    namedPlaceholders: true,
    decimalNumbers: true, // SUM()/AVG() come back as numbers, like SQLite
    supportBigNumbers: true,
    bigNumberStrings: false,
    dateStrings: true,
    charset: 'utf8mb4',
    connectTimeout: 15000,
    enableKeepAlive: true,
    ...(env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } } : {}),
  };
}

async function createMysqlDriver() {
  const mysql = (await import('mysql2/promise')).default;
  const pool = mysql.createPool(mysqlConfigFromEnv());
  // Fail fast with a clear (credential-free) message if the database is unreachable.
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
  } catch (err) {
    await pool.end().catch(() => {});
    throw new Error(`Cannot connect to MySQL at ${process.env.DB_HOST}:${process.env.DB_PORT || 3306} (${err.code || err.message})`);
  }
  for (const ddl of MYSQL_SCHEMA) await pool.query(ddl);

  const executor = () => txStore.getStore() || pool;
  const q = async (sql, params) => {
    const [rows] = await executor().query(sql, clean(params));
    return rows;
  };
  return {
    name: 'mysql',
    all: async (sql, params) => q(sql, params),
    get: async (sql, params) => (await q(sql, params))[0],
    async run(sql, params) {
      const res = await q(sql, params);
      return { insertId: Number(res.insertId), changes: Number(res.affectedRows) };
    },
    async transaction(fn) {
      if (txStore.getStore()) return fn(); // already inside a transaction
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const result = await txStore.run(conn, fn);
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
      } finally {
        conn.release();
      }
    },
    pool,
    close: async () => pool.end(),
  };
}

// ---------------------------------------------------------------- public API
/** Initialise the configured driver once (idempotent). */
export function initDatabase() {
  if (!initPromise) {
    initPromise = (resolveClient() === 'mysql' ? createMysqlDriver() : createSqliteDriver())
      .then((d) => (driver = d))
      .catch((err) => {
        initPromise = null; // allow a later retry
        throw err;
      });
  }
  return initPromise;
}

const ready = async () => driver || initDatabase();

export const dialect = () => driver?.name || resolveClient();
export const all = async (sql, params) => (await ready()).all(sql, params);
export const get = async (sql, params) => (await ready()).get(sql, params);
export const run = async (sql, params) => (await ready()).run(sql, params);
export const transaction = async (fn) => (await ready()).transaction(fn);

export async function closeDatabase() {
  const d = driver;
  driver = null;
  initPromise = null;
  if (d) await d.close();
}

/** Raw driver handle (tests and maintenance scripts only). */
export const rawDriver = async () => ready();
