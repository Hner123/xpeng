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

(async () => {
  const had = await db.hasSchema();
  await db.migrate();
  console.log(had ? 'schema already present — verified' : 'schema created');
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
