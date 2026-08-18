/* =============================================================
   Admin authentication — accounts, password hashing, sessions.

   Passwords: scrypt (node:crypto), per-user random salt, stored as
   scrypt$N$r$p$salt$hash. No bcrypt dependency needed.

   Sessions: a 32-byte random token goes to the client in an
   HttpOnly cookie; only its SHA-256 is stored, so a database dump
   can't be replayed as a live login.

   Roles (Section 7 of the brief):
     admin  — full access, invitations, exports, dealer mapping
     viewer — read-only dashboards, no personal-data export
   ============================================================= */
'use strict';

const crypto = require('node:crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_HOURS = 8;
const COOKIE = 'xfn_session';

function nowUTC(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace('T', ' ');
}

/* ---------- passwords ---------------------------------------- */

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

function verifyPassword(plain, stored) {
  try {
    const [scheme, N, r, p, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = crypto.scryptSync(plain, Buffer.from(salt, 'base64'), expected.length,
      { N: Number(N), r: Number(r), p: Number(p) });
    return crypto.timingSafeEqual(expected, actual);
  } catch (e) {
    return false;
  }
}

/* ---------- cookies ------------------------------------------ */

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

/* SameSite=Strict is the CSRF defence here: the browser will not
   attach this cookie to any cross-site request, so no third-party
   page can act on an admin's behalf. Secure is set when the app is
   served over HTTPS (behind a proxy, TRUST_PROXY_TLS=true). */
/* maxAgeSec: a positive number persists the cookie for that long;
   null omits Max-Age, making it a browser-session cookie that dies
   when the browser closes; 0 expires it now (used to sign out).
   Note Max-Age=0 deletes the cookie — it is NOT "session length". */
function cookieHeader(token, maxAgeSec, secure) {
  const bits = [
    COOKIE + '=' + (token || ''),
    'Path=/',
    'HttpOnly',
    'SameSite=Strict'
  ];
  if (maxAgeSec !== null && maxAgeSec !== undefined) bits.push('Max-Age=' + maxAgeSec);
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

/* ---------- login throttling --------------------------------- */
/* Per username+IP, so one attacker can't lock out a real admin by
   hammering their username from elsewhere. */
function throttle(maxAttempts = 8, windowMs = 15 * 60_000) {
  const hits = new Map();
  return {
    check(key) {
      const rec = hits.get(key);
      if (!rec) return { ok: true };
      if (Date.now() > rec.until) { hits.delete(key); return { ok: true }; }
      if (rec.count < maxAttempts) return { ok: true };
      return { ok: false, retryInSec: Math.ceil((rec.until - Date.now()) / 1000) };
    },
    fail(key) {
      const rec = hits.get(key) || { count: 0, until: Date.now() + windowMs };
      rec.count++;
      rec.until = Date.now() + windowMs;
      hits.set(key, rec);
    },
    clear(key) { hits.delete(key); }
  };
}

/* ---------- store -------------------------------------------- */

function make(db) {
  const limiter = throttle();

  /* First boot: create the admin account from env (or defaults) so
     there is a way in. Never overwrites an existing user. */
  async function ensureSeedUser(env) {
    const username = (env.ADMIN_USER || 'admin').trim();
    const password = env.ADMIN_PASS || 'futurenight';
    const existing = await db.get('SELECT id FROM admin_users WHERE username=?', [username]);
    if (existing) return { created: false, username };

    const anyUser = await db.get('SELECT id FROM admin_users LIMIT 1');
    await db.run(
      `INSERT INTO admin_users (username,display_name,password_hash,role,active,created_at)
       VALUES (?,?,?,?,1,?)`,
      [username, env.ADMIN_NAME || 'Campaign admin', hashPassword(password), 'admin', nowUTC()]
    );
    return { created: true, username, password, first: !anyUser };
  }

  async function login(username, password, meta) {
    const key = String(username).toLowerCase() + '|' + (meta.ip || '');
    const gate = limiter.check(key);
    if (!gate.ok) return { ok: false, error: 'locked', retryInSec: gate.retryInSec };

    const user = await db.get('SELECT * FROM admin_users WHERE username=? AND active=1', [String(username).trim()]);
    /* Hash even when the user doesn't exist, so response time
       doesn't reveal which usernames are real. */
    const stored = user ? user.password_hash : hashPassword('decoy-' + Math.random());
    const good = verifyPassword(password, stored);

    if (!user || !good) {
      limiter.fail(key);
      return { ok: false, error: 'bad_credentials' };
    }
    limiter.clear(key);

    const token = crypto.randomBytes(32).toString('hex');
    await db.run(
      `INSERT INTO admin_sessions (token_hash,user_id,created_at,expires_at,ip,user_agent)
       VALUES (?,?,?,?,?,?)`,
      [sha(token), user.id, nowUTC(), nowUTC(SESSION_HOURS * 3600e3), meta.ip || null,
       String(meta.ua || '').slice(0, 255)]
    );
    await db.run('UPDATE admin_users SET last_login_at=? WHERE id=?', [nowUTC(), user.id]);

    return {
      ok: true, token, maxAgeSec: SESSION_HOURS * 3600,
      user: { id: user.id, username: user.username, name: user.display_name, role: user.role }
    };
  }

  async function sessionFrom(cookieHeaderValue) {
    const token = parseCookies(cookieHeaderValue)[COOKIE];
    if (!token) return null;
    const row = await db.get(
      `SELECT s.id AS sid, s.expires_at, u.id, u.username, u.display_name, u.role, u.active
         FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
        WHERE s.token_hash=?`, [sha(token)]
    );
    if (!row || !row.active) return null;
    if (row.expires_at < nowUTC()) {
      await db.run('DELETE FROM admin_sessions WHERE id=?', [row.sid]);
      return null;
    }
    return { sid: row.sid, id: row.id, username: row.username, name: row.display_name, role: row.role };
  }

  async function logout(cookieHeaderValue) {
    const token = parseCookies(cookieHeaderValue)[COOKIE];
    if (token) await db.run('DELETE FROM admin_sessions WHERE token_hash=?', [sha(token)]);
  }

  async function sweepSessions() {
    const r = await db.run('DELETE FROM admin_sessions WHERE expires_at<?', [nowUTC()]);
    return r.changes;
  }

  async function users() {
    return db.all('SELECT id,username,display_name,role,active,created_at,last_login_at FROM admin_users ORDER BY id');
  }

  async function createUser({ username, password, role, name }) {
    if (!username || !password) throw new Error('username and password required');
    if (String(password).length < 10) throw new Error('password must be at least 10 characters');
    if (!['admin', 'viewer'].includes(role)) throw new Error('role must be admin or viewer');
    await db.run(
      `INSERT INTO admin_users (username,display_name,password_hash,role,active,created_at)
       VALUES (?,?,?,?,1,?)`,
      [String(username).trim(), name || null, hashPassword(password), role, nowUTC()]
    );
  }

  async function changePassword(userId, current, next) {
    if (String(next || '').length < 10) return { ok: false, error: 'too_short' };
    const user = await db.get('SELECT * FROM admin_users WHERE id=?', [userId]);
    if (!user || !verifyPassword(current, user.password_hash)) return { ok: false, error: 'bad_credentials' };
    await db.run('UPDATE admin_users SET password_hash=? WHERE id=?', [hashPassword(next), userId]);
    /* Every other session for this user dies with the change. */
    await db.run('DELETE FROM admin_sessions WHERE user_id=?', [userId]);
    return { ok: true };
  }

  return {
    ensureSeedUser, login, logout, sessionFrom, sweepSessions,
    users, createUser, changePassword, cookieHeader, COOKIE
  };
}

function sha(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }

module.exports = { make, hashPassword, verifyPassword, COOKIE };
