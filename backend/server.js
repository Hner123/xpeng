/* =============================================================
   XPENG FUTURE NIGHT — campaign server

   Zero npm dependencies: Node's own http + node:sqlite. Nothing
   to install, nothing to audit, nothing to break mid-campaign.
   Swap DB_DRIVER=mysql for staging (see lib/db.js).

   Serves three things:
     · the landing page (static, from the repo root)
     · POST /api/waitlist        — the public write path
     · /admin + /api/admin/*     — the dashboard, Basic-auth gated

   Run:  node backend/server.js
   ============================================================= */
'use strict';

const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbLayer  = require('./lib/db');
const vaultLib = require('./lib/crypto');
const storeLib = require('./lib/store');
const authLib  = require('./lib/auth');
const { validate } = require('./lib/validate');

const ROOT      = path.join(__dirname, '..');      // the landing page lives here
const BACKEND   = __dirname;
const ENV_FILE  = path.join(BACKEND, '.env');

/* ---------- env (no dotenv dependency) ---------------------- */
function loadEnv() {
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  /* First run: mint an APP_KEY so nobody ships a default one.
     Losing this file means losing the ability to read the data. */
  if (!process.env.APP_KEY) {
    const key = crypto.randomBytes(32).toString('hex');
    fs.appendFileSync(ENV_FILE,
      (fs.existsSync(ENV_FILE) ? '\n' : '') +
      '# Generated on first run. Back this up — the encrypted columns are unreadable without it.\n' +
      'APP_KEY=' + key + '\n');
    process.env.APP_KEY = key;
    console.log('[init] generated APP_KEY -> backend/.env');
  }
}
loadEnv();

const PORT     = Number(process.env.PORT || 3000);
const DRY_RUN  = process.env.COMMS_DRY_RUN !== 'false';
/* Set COOKIE_SECURE=true once the app is behind HTTPS, so the
   session cookie is never sent over plain http. */
const SECURE_COOKIES = process.env.COOKIE_SECURE === 'true';
/* Where the public campaign page is hosted. The dashboard's "View
   landing page" button points here — set it when the front-end moves
   to its own domain, so the link never goes stale. */
const PUBLIC_SITE = process.env.PUBLIC_SITE_URL || 'https://x-peng.netlify.app';
/* Origins allowed to call the PUBLIC endpoints cross-site — set this
   to the Netlify URL when the page and API live on different hosts.
   Comma-separated, exact origins only, never '*'. Admin routes are
   deliberately excluded: the dashboard is same-origin on this server
   so its cookie can stay SameSite=Strict. */
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

/* Province/city whitelist is shared with the page — one source. */
function loadGeo() {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'geo.js'), 'utf8');
    const sandbox = { window: {} };
    new Function('window', src)(sandbox.window);
    return sandbox.window.XPENG_GEO || null;
  } catch (e) {
    console.warn('[warn] could not read geo.js, city whitelist disabled:', e.message);
    return null;
  }
}

/* ---------- tiny http helpers -------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff', '.otf': 'font/otf', '.ttf': 'font/ttf'
};

function send(res, code, body, headers) {
  const h = Object.assign({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN'
  }, headers || {});
  res.writeHead(code, h);
  res.end(body);
}

function json(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

/* Fixed-window rate limit per IP. Generous for the write path —
   the point is stopping a script, not throttling a traffic spike. */
function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return function (ip) {
    const n = (hits.get(ip) || 0) + 1;
    hits.set(ip, n);
    return n <= max;
  };
}
const writeLimit = limiter(Number(process.env.RATE_LIMIT || 30), 60_000);
const adminLimit = limiter(600, 60_000);
const loginLimit = limiter(20, 60_000);   // per IP; lib/auth adds per-account lockout

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0] : req.socket.remoteAddress || '').trim();
}

/* Adds CORS headers when the caller's Origin is on the allow-list.
   Returns true if the request was a preflight and is now answered. */
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');               // so caches don't cross-serve
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    send(res, origin && ALLOWED_ORIGINS.includes(origin) ? 204 : 403, '');
    return true;
  }
  return false;
}

/* Unauthenticated: send browsers to the login page, APIs a 401. */
function needAuth(req, res, pathname) {
  const wantsHtml = (req.headers.accept || '').includes('text/html');
  if (wantsHtml) {
    const next = encodeURIComponent(pathname || '/admin');
    return send(res, 302, '', { Location: '/admin/login?next=' + next, 'Cache-Control': 'no-store' });
  }
  return json(res, 401, { ok: false, error: 'unauthenticated' });
}

/* Read-only accounts may not touch anything that writes or that
   exports personal data (Section 7: XPENG viewer). */
function needAdmin(res) {
  return json(res, 403, { ok: false, error: 'forbidden', message: 'This account is read-only.' });
}

/* ---------- static ------------------------------------------ */
const STATIC_OK = new Set(['/', '/index.html', '/styles.css', '/app.js', '/config.js', '/geo.js',
                           '/favicon.ico', '/favicon.svg', '/site.webmanifest', '/robots.txt']);
/* Asset folders served wholesale: brand fonts and the key art. */
const STATIC_DIRS = /^\/(assets|img|font|image)\//;

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  if (!STATIC_OK.has(pathname) && !STATIC_DIRS.test(rel)) return false;

  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;

  const ext = path.extname(file).toLowerCase();
  const body = fs.readFileSync(file);
  send(res, 200, body, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    /* The page is static and CDN-cached in production; short TTL
       here so config.js edits show up on reload during review. */
    /* Fonts and images never change without a filename change;
       code files stay short-lived so config.js edits show up fast. */
    'Cache-Control': ext === '.html' ? 'no-cache'
      : /\.(otf|ttf|woff2?|webp|jpg|png|svg|ico)$/.test(file) ? 'public, max-age=31536000, immutable'
      : 'public, max-age=60'
  });
  return true;
}

/* ---------- comms worker ------------------------------------ */
/* Providers aren't wired yet, so this drains the queue to a log
   file. That keeps the pipeline observable end to end: you can see
   exactly what would have been sent, to whom, with which code. */
function startCommsWorker(store, auth) {
  const outbox = path.join(BACKEND, 'data', 'outbox.log');
  async function tick() {
    try {
      const batch = await store.takePending(25);
      for (const msg of batch) {
        const line = JSON.stringify({
          at: new Date().toISOString(),
          id: msg.id, channel: msg.channel, template: msg.template,
          to: DRY_RUN ? '[dry-run]' : undefined,
          payload: msg.payload ? JSON.parse(msg.payload) : null
        });
        fs.appendFileSync(outbox, line + '\n');
        await store.markSent(msg.id, null);
      }
      const expired = await store.expireStale();
      if (expired) console.log('[comms] expired ' + expired + ' unclaimed invitation(s)');
      if (auth) await auth.sweepSessions();
    } catch (e) {
      console.error('[comms] worker error:', e.message);
    }
  }
  setInterval(tick, 10_000).unref();
  tick();
}

/* ---------- routes ------------------------------------------ */
async function main() {
  const db = dbLayer.open(process.env);

  /* SQLite owns its own file, so it can create the schema on boot.
     MySQL must not: the app user deliberately has no DDL grant, and
     schema changes are a deliberate operational step. Verify and
     fail with instructions instead of guessing. */
  if (db.name === 'sqlite') {
    await db.migrate();
  } else if (!(await db.hasSchema())) {
    console.error('');
    console.error('  The database has no tables yet. Load the schema once:');
    console.error('    sudo mysql ' + (process.env.DB_NAME || 'xpeng_future_night') +
                  ' < backend/schema.mysql.sql');
    console.error('');
    process.exit(1);
  }
  const vault = vaultLib.make(process.env.APP_KEY);
  const store = storeLib.make(db, vault);
  const auth = authLib.make(db);
  const GEO = loadGeo();

  const seeded = await auth.ensureSeedUser(process.env);
  if (seeded.created) {
    console.log('[init] created admin account "' + seeded.username + '"' +
      (process.env.ADMIN_PASS ? '' : ' with the default password'));
  }

  startCommsWorker(store, auth);

  const server = http.createServer(async (req, res) => {
    /* URL parsing must be inside the guard: a malformed request line
       such as "//" throws ERR_INVALID_URL, and an uncaught throw here
       takes the whole process down — one bad request would kill the
       campaign API. Answer 400 and stay up. */
    let url;
    try {
      url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    } catch (e) {
      return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const p = url.pathname;
    const q = Object.fromEntries(url.searchParams);

    try {
      /* Public API is CORS-aware; preflights end here. */
      if (p.startsWith('/api/waitlist')) {
        if (cors(req, res)) return;
      }

      /* ---- public: static page ---- */
      if (req.method === 'GET' && serveStatic(req, res, p)) return;

      /* ---- public: register ---- */
      if (p === '/api/waitlist' && req.method === 'POST') {
        if (!writeLimit(clientIp(req))) return json(res, 429, { ok: false, error: 'slow_down' });

        const body = await readBody(req);
        const v = validate(body, GEO);
        if (!v.ok) return json(res, 422, { ok: false, errors: v.errors });

        const saved = await store.saveRegistration(v.value, { ip: clientIp(req) });
        /* Duplicates land here too and get the normal confirmation —
           the list mechanics are never revealed (Section 5). */
        return json(res, 200, { ok: true, sequence: saved.sequence });
      }

      if (p === '/api/waitlist/count' && req.method === 'GET') {
        return json(res, 200, { ok: true, total: await store.publicCount() });
      }

      /* ---- dev: stand in for the SM Tickets claim callback ---- */
      if (p === '/api/dev/claim' && req.method === 'POST') {
        const body = await readBody(req);
        return json(res, 200, await store.markClaimed(String(body.code || '')));
      }

      /* ---- auth: login page + session endpoints (public) ---- */
      if (p === '/admin/login' && req.method === 'GET') {
        /* Already signed in? Don't show the form again. */
        if (await auth.sessionFrom(req.headers.cookie)) {
          return send(res, 302, '', { Location: '/admin', 'Cache-Control': 'no-store' });
        }
        return send(res, 200, fs.readFileSync(path.join(BACKEND, 'admin', 'login.html')),
          { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      }

      if (p === '/api/auth/login' && req.method === 'POST') {
        if (!loginLimit(clientIp(req))) return json(res, 429, { ok: false, error: 'locked', retryInSec: 60 });
        const body = await readBody(req);
        const out = await auth.login(String(body.username || ''), String(body.password || ''),
          { ip: clientIp(req), ua: req.headers['user-agent'] });

        if (!out.ok) {
          console.log('[auth] failed login for "' + String(body.username || '').slice(0, 40) + '" from ' + clientIp(req));
          return json(res, 401, out);
        }
        /* "Keep me signed in" only extends the cookie's lifetime;
           the server-side session expiry is the real limit. */
        const maxAge = body.remember ? out.maxAgeSec : null;   // null = dies with the browser session
        res.setHeader('Set-Cookie', auth.cookieHeader(out.token, maxAge, SECURE_COOKIES));
        console.log('[auth] ' + out.user.username + ' (' + out.user.role + ') signed in from ' + clientIp(req));
        return json(res, 200, { ok: true, user: out.user });
      }

      if (p === '/api/auth/logout' && req.method === 'POST') {
        await auth.logout(req.headers.cookie);
        res.setHeader('Set-Cookie', auth.cookieHeader('', 0, SECURE_COOKIES));
        return json(res, 200, { ok: true });
      }

      /* ---- everything below needs a session ---- */
      if (p === '/admin' || p.startsWith('/api/admin')) {
        const session = await auth.sessionFrom(req.headers.cookie);
        if (!session) return needAuth(req, res, p);
        const actor = session.username;
        const isAdmin = session.role === 'admin';
        if (!adminLimit(clientIp(req))) return json(res, 429, { ok: false, error: 'slow_down' });

        if (p === '/admin' && req.method === 'GET') {
          return send(res, 200, fs.readFileSync(path.join(BACKEND, 'admin', 'index.html')),
            { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        }
        if (p === '/api/admin/me' && req.method === 'GET') {
          return json(res, 200, { ok: true, user: session, publicSite: PUBLIC_SITE });
        }
        if (p === '/api/admin/stats' && req.method === 'GET') {
          return json(res, 200, { ok: true, ...(await store.stats()) });
        }
        if (p === '/api/admin/registrations' && req.method === 'GET') {
          const page = await store.list(q);
          if (!isAdmin) page.rows = page.rows.map(r => {
            const { mobile, email, mobile_masked, ...rest } = r;
            return rest;                                 // read-only role sees no contact details
          });
          return json(res, 200, { ok: true, role: session.role, ...page });
        }
        if (p === '/api/admin/invite' && req.method === 'POST') {
          if (!isAdmin) return needAdmin(res);
          const body = await readBody(req);
          const ids = (body.ids || []).map(Number).filter(Boolean);
          if (!ids.length) return json(res, 422, { ok: false, error: 'no ids' });
          return json(res, 200, { ok: true, ...(await store.invite(ids, Number(body.hours || 72), body.resend === true)) });
        }
        if (p === '/api/admin/export.csv' && req.method === 'GET') {
          if (!isAdmin) return needAdmin(res);          // no personal-data export for viewers
          const { csv, count } = await store.exportCsv(q, actor);
          const name = 'xpeng-future-night-' + (q.dealer ? 'dealer-' : '') + new Date().toISOString().slice(0, 10) + '.csv';
          return send(res, 200, '﻿' + csv, {          // BOM so Excel reads ₱ and ñ
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="' + name + '"',
            'X-Row-Count': String(count),
            'Cache-Control': 'no-store'
          });
        }
        if (p === '/api/admin/exports' && req.method === 'GET') {
          return json(res, 200, { ok: true, rows: await store.exportLog() });
        }
        if (p === '/api/admin/comms' && req.method === 'GET') {
          const rows = await store.comms(q.status);
          if (!isAdmin) rows.forEach(r => { r.recipient = '[hidden]'; });
          return json(res, 200, { ok: true, rows });
        }
        if (p === '/api/admin/dealers' && req.method === 'GET') {
          return json(res, 200, { ok: true, rows: await store.dealers() });
        }
        if (p === '/api/admin/dealers' && req.method === 'POST') {
          if (!isAdmin) return needAdmin(res);
          const body = await readBody(req);
          if (!body.city || !body.dealer) return json(res, 422, { ok: false, error: 'city and dealer required' });
          await store.setDealer(String(body.city), String(body.dealer));
          return json(res, 200, { ok: true });
        }
        /* Destructive routes: admin only, never the viewer role. */
        if (p === '/api/admin/delete' && req.method === 'POST') {
          if (!isAdmin) return needAdmin(res);
          const body = await readBody(req);
          const ids = (body.ids || []).map(Number).filter(Boolean);
          if (!ids.length) return json(res, 422, { ok: false, error: 'no ids' });
          const out = await store.deleteRegistrations(ids, actor);
          console.log('[audit] ' + actor + ' deleted ' + out.removed + ' registration(s): ' + ids.join(','));
          return json(res, 200, { ok: true, ...out });
        }
        if (p === '/api/admin/anonymise' && req.method === 'POST') {
          if (!isAdmin) return needAdmin(res);
          const body = await readBody(req);
          const ids = (body.ids || []).map(Number).filter(Boolean);
          if (!ids.length) return json(res, 422, { ok: false, error: 'no ids' });
          const out = await store.anonymise(ids, actor);
          console.log('[audit] ' + actor + ' anonymised ' + out.anonymised + ' registration(s): ' + ids.join(','));
          return json(res, 200, { ok: true, ...out });
        }
        if (p === '/api/admin/purge-test' && req.method === 'POST') {
          if (!isAdmin) return needAdmin(res);
          const out = await store.purgeTestData(actor);
          console.log('[audit] ' + actor + ' purged ' + out.removed + ' test registration(s)');
          return json(res, 200, { ok: true, ...out });
        }
        if (p === '/api/admin/rescore' && req.method === 'POST') {
          if (!isAdmin) return needAdmin(res);
          return json(res, 200, { ok: true, updated: await store.rescoreAll() });
        }
        if (p === '/api/admin/password' && req.method === 'POST') {
          const body = await readBody(req);
          const out = await auth.changePassword(session.id, String(body.current || ''), String(body.next || ''));
          if (!out.ok) return json(res, 400, out);
          /* Changing the password kills every session, this one
             included — the client is expected to sign in again. */
          res.setHeader('Set-Cookie', auth.cookieHeader('', 0, SECURE_COOKIES));
          return json(res, 200, { ok: true });
        }
        if (p === '/api/admin/users' && req.method === 'GET') {
          if (!isAdmin) return needAdmin(res);
          return json(res, 200, { ok: true, rows: await auth.users() });
        }
        if (p === '/api/admin/users' && req.method === 'POST') {
          if (!isAdmin) return needAdmin(res);
          const body = await readBody(req);
          try {
            await auth.createUser({
              username: body.username, password: body.password,
              role: body.role || 'viewer', name: body.name
            });
            return json(res, 200, { ok: true });
          } catch (e) {
            return json(res, 422, { ok: false, error: e.message });
          }
        }
        return json(res, 404, { ok: false, error: 'not found' });
      }

      return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });

    } catch (err) {
      console.error('[error]', req.method, p, '-', err.message);
      /* Never leak internals to the public write path. */
      return json(res, 500, { ok: false, error: 'server_error' });
    }
  });

  /* Nothing should reach these, but a campaign server must not die
     from an unexpected throw mid-boost. Log and keep serving. */
  process.on('uncaughtException', err => {
    console.error('[fatal-guard] uncaught:', err && err.stack || err);
  });
  process.on('unhandledRejection', err => {
    console.error('[fatal-guard] unhandled rejection:', err && err.stack || err);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error('');
      console.error('  Port ' + PORT + ' is already in use by another app on this server.');
      console.error('  Pick a free one: set PORT= in backend/.env (e.g. 3010) and restart,');
      console.error('  then point the reverse proxy at the new port.');
      console.error('');
      process.exit(1);
    }
    throw err;
  });

  server.listen(PORT, () => {
    console.log('');
    console.log('  XPENG FUTURE NIGHT — campaign server');
    console.log('  ------------------------------------');
    console.log('  landing page   http://localhost:' + PORT + '/');
    console.log('  admin login    http://localhost:' + PORT + '/admin/login');
    console.log('  database       ' + db.name + (db.name === 'sqlite' ? '  (backend/data/future-night.db)' : ''));
    console.log('  comms          ' + (DRY_RUN ? 'DRY RUN -> backend/data/outbox.log' : 'LIVE'));
    console.log('');
    if (!process.env.ADMIN_PASS) {
      console.log('  user  ' + (process.env.ADMIN_USER || 'admin') + '   password  futurenight   (default)');
      console.log('  ⚠  set ADMIN_USER / ADMIN_PASS in backend/.env, or change it from the dashboard, before staging');
      console.log('');
    }
  });
}

main().catch(err => {
  console.error('failed to start:', err);
  process.exit(1);
});
