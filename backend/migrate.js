/* Loads the schema deliberately, outside of app boot.

   In production MySQL runs with no DDL grant for the app user, so
   the schema is normally loaded by an admin instead:
     sudo mysql <database> < backend/schema.mysql.sql

   Usage: node backend/migrate.js
*/
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ENV = path.join(__dirname, '.env');
if (fs.existsSync(ENV)) {
  for (const line of fs.readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const db = require('./lib/db').open(process.env);

/* Columns added after the first release. CREATE TABLE IF NOT EXISTS
   cannot introduce these into an existing table, so they are checked
   and added explicitly. */
const ADDED_COLUMNS = [
  { table: 'registrations', column: 'first_name_enc',
    sqlite: 'TEXT', mysql: 'VARBINARY(256) DEFAULT NULL' },
  { table: 'registrations', column: 'last_name_enc',
    sqlite: 'TEXT', mysql: 'VARBINARY(256) DEFAULT NULL' }
];

async function ensureColumns() {
  for (const c of ADDED_COLUMNS) {
    let exists;
    if (db.name === 'sqlite') {
      const cols = await db.all('PRAGMA table_info(' + c.table + ')');
      exists = cols.some(x => x.name === c.column);
    } else {
      const r = await db.get(
        `SELECT COUNT(*) AS n FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
        [c.table, c.column]);
      exists = Number(r.n) > 0;
    }
    if (exists) { console.log('  ' + c.column + ': present'); continue; }

    if (db.name === 'sqlite') {
      await db.run('ALTER TABLE ' + c.table + ' ADD COLUMN ' + c.column + ' ' + c.sqlite);
      console.log('  ' + c.column + ': added');
    } else {
      /* The app user has no ALTER grant, so hand over the exact SQL. */
      console.log('');
      console.log('  MISSING: ' + c.table + '.' + c.column);
      console.log('  Run this as an admin:');
      console.log('    sudo mysql ' + (process.env.DB_NAME || 'xpeng_future_night') +
                  ' < backend/migrations/2026-08-25-split-name.sql');
      console.log('');
      process.exitCode = 1;
    }
  }
}

(async () => {
  const had = await db.hasSchema();
  await db.migrate();
  console.log(had ? 'schema already present — verified' : 'schema created');
  await ensureColumns();
  await db.close();
})().catch(err => {
  console.error(err.message);
  if (/denied/i.test(err.message)) {
    console.error('The app user has no DDL grant (by design). Load it as an admin:');
    console.error('  sudo mysql ' + (process.env.DB_NAME || 'xpeng_future_night') +
                  ' < backend/schema.mysql.sql');
  }
  process.exit(1);
});
