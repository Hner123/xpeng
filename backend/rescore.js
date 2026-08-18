/* Recompute every lead score after editing lib/score.js weights.
   Usage: node backend/rescore.js  */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const ENV = path.join(__dirname, '.env');
if (fs.existsSync(ENV)) for (const l of fs.readFileSync(ENV,'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,'');
}
const db = require('./lib/db').open(process.env);
const store = require('./lib/store').make(db, require('./lib/crypto').make(process.env.APP_KEY));
store.rescoreAll().then(n => { console.log('rescored ' + n + ' records'); return db.close(); })
  .catch(e => { console.error(e); process.exit(1); });
