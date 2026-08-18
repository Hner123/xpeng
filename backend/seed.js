/* =============================================================
   Seeds fake registrations so the dashboard has something to show.
   Dev only — never point this at a real database.

   Usage:  node backend/seed.js [count]
   ============================================================= */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbLayer = require('./lib/db');
const vaultLib = require('./lib/crypto');
const storeLib = require('./lib/store');

/* Load .env the same way server.js does. */
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (!process.env.APP_KEY) {
  console.error('No APP_KEY. Start the server once first: node backend/server.js');
  process.exit(1);
}

const GEO = (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'geo.js'), 'utf8');
  const w = {};
  new Function('window', src)(w);
  return w.XPENG_GEO;
})();

const FIRST = ['Maria','Jose','Anna','Juan','Grace','Paolo','Liza','Mark','Christine','Ramon','Jasmine','Nathan',
  'Angelica','Miguel','Kristine','Carlo','Divine','Emmanuel','Rowena','Dennis','Sheila','Arnel','Joy','Rafael'];
const LAST = ['Santos','Reyes','Cruz','Bautista','Garcia','Torres','Mendoza','Aquino','Ramos','Del Rosario',
  'Villanueva','Castillo','Flores','Domingo','Navarro','Pascual','Salazar','Ocampo'];

const AGES    = ['18–24','25–34','35–44','45–54','55+'];
const SEGS    = ['Business owner','Professional / employee','Government','OFW / OFW family','Student','Other'];
const INTENTS = ['Within 3 months','3–6 months','6–12 months','Over a year','Just exploring'];
const BUDGETS = ['Under ₱1.5M','₱1.5–2.5M','₱2.5–4M','₱4M+','Prefer not to say'];
const MODELS  = ['X9 luxury MPV','L03 SUV','The full line-up','Just curious about the AI'];
const EVS     = ['Own an EV','Have test-driven','Never tried'];
const BRANDS  = ['Toyota','Mitsubishi','Nissan','Honda','Ford','Hyundai','Kia','Suzuki','Isuzu','BYD','MG','No car yet'];
const SOURCES = [
  { utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'futurenight_teaser' },
  { utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'futurenight_reveal' },
  { utm_source: 'tiktok',   utm_medium: 'paid_social', utm_campaign: 'futurenight_teaser' },
  { utm_source: 'google',   utm_medium: 'cpc',         utm_campaign: 'futurenight_search' },
  { utm_source: 'instagram',utm_medium: 'organic',     utm_campaign: 'futurenight_bio' },
  {}
];

const pick = a => a[Math.floor(Math.random() * a.length)];

/* Weighted so the pool looks like real traffic: mostly Metro Manila
   and nearby provinces, a long tail everywhere else. */
const HOT = ['Metro Manila (NCR)','Metro Manila (NCR)','Metro Manila (NCR)','Cavite','Laguna','Bulacan','Rizal',
  'Pampanga','Cebu','Davao del Sur','Batangas','Negros Occidental'];
const ALL = Object.keys(GEO);

async function main() {
  const count = Number(process.argv[2] || 40);
  const db = dbLayer.open(process.env);
  await db.migrate();
  const store = storeLib.make(db, vaultLib.make(process.env.APP_KEY));

  let done = 0;
  for (let i = 0; i < count; i++) {
    const province = Math.random() < 0.72 ? pick(HOT) : pick(ALL);
    const city = pick(GEO[province]);
    const first = pick(FIRST), last = pick(LAST);
    const partial = Math.random() < 0.14;          // ~14% abandon at Step 2

    const rec = {
      name: first + ' ' + last,
      mobile: '09' + String(Math.floor(100000000 + Math.random() * 899999999)),
      email: (first + '.' + last).toLowerCase().replace(/[^a-z.]/g, '') + (1000 + i) + '@example.com',
      province, city,
      partial,
      profile: partial ? {} : {
        age: pick(AGES), segment: pick(SEGS), drives: pick(BRANDS),
        intent: pick(INTENTS), budget: pick(BUDGETS), model: pick(MODELS), ev: pick(EVS)
      },
      consents: partial ? {} : {
        privacy: true,
        dealer: Math.random() < 0.78,              // most tick it, some don't
        marketing: Math.random() < 0.55
      },
      utm: pick(SOURCES)
    };

    await store.saveRegistration(rec, { ip: '127.0.0.1' });
    done++;
  }

  /* Backdate a spread of created_at so the daily curve has shape. */
  const rows = await db.all('SELECT id FROM registrations ORDER BY id');
  for (const r of rows) {
    const daysAgo = Math.floor(Math.pow(Math.random(), 1.6) * 13);   // skewed to recent
    const d = new Date(Date.now() - daysAgo * 86400e3 - Math.random() * 86400e3);
    await db.run('UPDATE registrations SET created_at=? WHERE id=?',
      [d.toISOString().slice(0, 19).replace('T', ' '), r.id]);
  }

  /* A couple of dealer territories so the mapping is visible. */
  for (const [city, dealer] of [
    ['Makati', 'XPENG Makati'], ['Quezon City', 'XPENG QC North'], ['Taguig', 'XPENG BGC'],
    ['Bacoor', 'XPENG Cavite'], ['Santa Rosa', 'XPENG Laguna'], ['Cebu City', 'XPENG Cebu'],
    ['Davao City', 'XPENG Davao'], ['Angeles', 'XPENG Clark']
  ]) {
    await store.setDealer(city, dealer);
  }

  console.log('seeded ' + done + ' registrations (' + rows.length + ' total in table)');
  console.log('open http://localhost:' + (process.env.PORT || 3000) + '/admin');
  await db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
