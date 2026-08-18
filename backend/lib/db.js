/* =============================================================
   Storage layer — one interface, two drivers.

   DB_DRIVER=sqlite (default)  local dev, zero setup, node:sqlite
   DB_DRIVER=mysql             staging/production, needs mysql2

   All queries use `?` placeholders, which both drivers speak, so
   the only per-driver SQL is the upsert (ON CONFLICT vs ON
   DUPLICATE KEY) and it lives in one place below.

   Every method is async so callers don't care which driver is
   underneath, even though SQLite runs synchronously.
   ============================================================= */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* ---------- SQLite ------------------------------------------- */
function sqliteDriver(cfg) {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(cfg.file), { recursive: true });
  const db = new DatabaseSync(cfg.file);

  db.exec('PRAGMA journal_mode = WAL');    // concurrent reads while writing
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  return {
    name: 'sqlite',
    async migrate() {
      db.exec(fs.readFileSync(path.join(ROOT, 'schema.sqlite.sql'), 'utf8'));
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async get(sql, params = []) {
      return db.prepare(sql).get(...params) || null;
    },
    async run(sql, params = []) {
      const r = db.prepare(sql).run(...params);
      return { insertId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    /* SQLite flavour of the dedupe upsert. */
    upsertSql(table, cols, conflictCol, updateCols) {
      const ph = cols.map(() => '?').join(',');
      const set = updateCols.map(c => `${c}=excluded.${c}`).join(',');
      return `INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph})
              ON CONFLICT(${conflictCol}) DO UPDATE SET ${set}`;
    },
    async close() { db.close(); }
  };
}

/* ---------- MySQL -------------------------------------------- */
function mysqlDriver(cfg) {
  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch (e) {
    throw new Error(
      'DB_DRIVER=mysql needs the mysql2 package. Run: npm install mysql2 --prefix backend'
    );
  }
  const pool = mysql.createPool({
    host: cfg.host, port: cfg.port, user: cfg.user,
    password: cfg.password, database: cfg.database,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: cfg.poolSize,
    queueLimit: 0,
    timezone: '+08:00',       // Manila, so DATE() filters match local days
    dateStrings: true
  });

  return {
    name: 'mysql',
    async migrate() {
      const sql = fs.readFileSync(path.join(ROOT, 'schema.mysql.sql'), 'utf8');
      const conn = await pool.getConnection();
      try {
        for (const stmt of sql.split(/;\s*[\r\n]/).map(s => s.trim()).filter(s => s && !s.startsWith('--'))) {
          await conn.query(stmt);
        }
      } finally { conn.release(); }
    },
    async all(sql, params = []) {
      const [rows] = await pool.query(sql, params);
      return rows;
    },
    async get(sql, params = []) {
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    },
    async run(sql, params = []) {
      const [res] = await pool.query(sql, params);
      return { insertId: res.insertId, changes: res.affectedRows };
    },
    upsertSql(table, cols, conflictCol, updateCols) {
      const ph = cols.map(() => '?').join(',');
      const set = updateCols.map(c => `${c}=VALUES(${c})`).join(',');
      return `INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph})
              ON DUPLICATE KEY UPDATE ${set}`;
    },
    async close() { await pool.end(); }
  };
}

function open(env) {
  const driver = (env.DB_DRIVER || 'sqlite').toLowerCase();
  if (driver === 'mysql') {
    return mysqlDriver({
      host: env.DB_HOST || '127.0.0.1',
      port: Number(env.DB_PORT || 3306),
      user: env.DB_USER || 'root',
      password: env.DB_PASSWORD || '',
      database: env.DB_NAME || 'xpeng_future_night',
      poolSize: Number(env.DB_POOL || 10)
    });
  }
  return sqliteDriver({ file: env.DB_FILE || path.join(ROOT, 'data', 'future-night.db') });
}

module.exports = { open };
