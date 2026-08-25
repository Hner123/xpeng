/* =============================================================
   Repository — every SQL statement in the app lives here.
   Routes deal in plain objects; only this file knows the schema.
   ============================================================= */
'use strict';

const crypto = require('node:crypto');
const { scoreOf } = require('./score');

const REG_COLS = [
  'created_at','updated_at','name_enc','first_name_enc','last_name_enc',
  'mobile_enc','email_enc','mobile_hash','email_hash',
  'province','city','dealer','status','partial','otp_verified','lead_score',
  'age','segment','drives','intent','budget','model_interest','ev_experience',
  'consent_privacy','consent_privacy_at','consent_dealer','consent_dealer_at',
  'consent_marketing','consent_marketing_at',
  'utm_source','utm_medium','utm_campaign','utm_content','utm_term','click_id','referrer','landing_path'
];

/* On a duplicate we refresh everything except created_at — the
   original join date is what the sequence number is based on. */
const UPDATE_COLS = REG_COLS.filter(c => c !== 'created_at');

function nowUTC() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function make(db, vault) {

  /* ---------- write path (public, hot) ----------------------- */

  async function saveRegistration(input, meta) {
    const now = nowUTC();
    const p = input.profile || {};
    const c = input.consents || {};
    const u = input.utm || {};

    const answers = {
      age: p.age || null, segment: p.segment || null, drives: p.drives || null,
      intent: p.intent || null, budget: p.budget || null,
      model_interest: p.model || null, ev_experience: p.ev || null
    };

    const dealer = await dealerFor(input.city);
    const consentAt = c.at || now;

    const row = {
      created_at: now,
      updated_at: now,
      name_enc:       vault.encrypt(input.name),
      first_name_enc: input.first_name ? vault.encrypt(input.first_name) : null,
      last_name_enc:  input.last_name  ? vault.encrypt(input.last_name)  : null,
      mobile_enc: vault.encrypt(input.mobile),
      email_enc:  vault.encrypt(input.email),
      mobile_hash: vault.lookup(input.mobile),
      email_hash:  vault.lookup(input.email),
      province: input.province,
      city: input.city,
      dealer,
      status: 'REGISTERED',
      partial: input.partial ? 1 : 0,
      otp_verified: 0,
      lead_score: scoreOf(answers),
      ...answers,
      consent_privacy:      c.privacy ? 1 : 0,
      consent_privacy_at:   c.privacy ? consentAt : null,
      consent_dealer:       c.dealer ? 1 : 0,
      consent_dealer_at:    c.dealer ? consentAt : null,
      consent_marketing:    c.marketing ? 1 : 0,
      consent_marketing_at: c.marketing ? consentAt : null,
      utm_source: u.utm_source || null,
      utm_medium: u.utm_medium || null,
      utm_campaign: u.utm_campaign || null,
      utm_content: u.utm_content || null,
      utm_term: u.utm_term || null,
      click_id: u.fbclid || u.ttclid || u.gclid || null,
      referrer: (u.referrer || '').slice(0, 255) || null,
      landing_path: u.landing_path || null
    };

    /* Dedupe on mobile; silently update, never error (Section 5).
       A second unique index on email catches the mixed case. */
    const sql = db.upsertSql('registrations', REG_COLS, 'mobile_hash', UPDATE_COLS);
    let res;
    try {
      res = await db.run(sql, REG_COLS.map(k => row[k]));
    } catch (err) {
      if (!isDuplicate(err)) throw err;
      /* Same email on a different mobile — update the email row. */
      await db.run(
        `UPDATE registrations SET ${UPDATE_COLS.map(c2 => c2 + '=?').join(',')} WHERE email_hash=?`,
        [...UPDATE_COLS.map(k => row[k]), row.email_hash]
      );
      res = { insertId: 0 };
    }

    const found = await db.get(
      'SELECT id, partial FROM registrations WHERE mobile_hash=? OR email_hash=? LIMIT 1',
      [row.mobile_hash, row.email_hash]
    );
    const id = found ? found.id : res.insertId;

    /* Confirmation goes out once, on the completed record only —
       a Step-1 abandon shouldn't get a "you're on the waitlist" SMS. */
    if (!input.partial) await queueConfirmation(id, input.email, input.mobile);

    return { id, sequence: id };
  }

  function isDuplicate(err) {
    const m = String(err && err.message);
    return /UNIQUE constraint failed|ER_DUP_ENTRY|Duplicate entry/i.test(m);
  }

  async function dealerFor(city) {
    if (!city) return null;
    const row = await db.get('SELECT dealer FROM dealer_territories WHERE city=?', [city]);
    return row ? row.dealer : null;
  }

  async function queueConfirmation(regId, email, mobile) {
    const existing = await db.get(
      "SELECT id FROM comms_queue WHERE registration_id=? AND template='waitlist_confirmation'",
      [regId]
    );
    if (existing) return;
    const payload = JSON.stringify({ sequence: regId });
    for (const [channel, to] of [['email', email], ['sms', mobile]]) {
      await db.run(
        `INSERT INTO comms_queue (registration_id,channel,template,recipient_enc,payload,created_at)
         VALUES (?,?,?,?,?,?)`,
        [regId, channel, 'waitlist_confirmation', vault.encrypt(to), payload, nowUTC()]
      );
    }
  }

  async function publicCount() {
    const r = await db.get("SELECT COUNT(*) AS n FROM registrations WHERE partial=0");
    return r ? Number(r.n) : 0;
  }

  /* ---------- read path (admin) ------------------------------ */

  function whereFrom(q) {
    const cond = [], args = [];
    if (q.city)     { cond.push('city=?');        args.push(q.city); }
    if (q.province) { cond.push('province=?');    args.push(q.province); }
    if (q.status)   { cond.push('status=?');      args.push(q.status); }
    if (q.intent)   { cond.push('intent=?');      args.push(q.intent); }
    if (q.budget)   { cond.push('budget=?');      args.push(q.budget); }
    if (q.segment)  { cond.push('segment=?');     args.push(q.segment); }
    if (q.source)   { cond.push('utm_source=?');  args.push(q.source); }
    if (q.dealer)   { cond.push('dealer=?');      args.push(q.dealer); }
    if (q.from)     { cond.push('created_at>=?'); args.push(q.from + ' 00:00:00'); }
    if (q.to)       { cond.push('created_at<=?'); args.push(q.to + ' 23:59:59'); }
    if (q.complete === '1') cond.push('partial=0');
    if (q.complete === '0') cond.push('partial=1');
    if (q.consent_dealer === '1') cond.push('consent_dealer=1');
    if (q.min_score) { cond.push('lead_score>=?'); args.push(Number(q.min_score)); }
    return { sql: cond.length ? 'WHERE ' + cond.join(' AND ') : '', args };
  }

  const SORTS = {
    recent: 'created_at DESC, id DESC',
    score:  'lead_score DESC, created_at DESC',
    city:   'city ASC, lead_score DESC'
  };

  async function list(q) {
    const w = whereFrom(q);
    const order = SORTS[q.sort] || SORTS.recent;
    const limit = Math.min(500, Math.max(1, Number(q.limit || 50)));
    const offset = Math.max(0, Number(q.offset || 0));

    const rows = await db.all(
      `SELECT * FROM registrations ${w.sql} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...w.args, limit, offset]
    );
    const total = await db.get(`SELECT COUNT(*) AS n FROM registrations ${w.sql}`, w.args);

    return { total: Number(total ? total.n : 0), limit, offset, rows: rows.map(decorate) };
  }

  /* Decrypt for display. Mobile is masked unless the caller asks
     for a dealer export — the dashboard doesn't need full numbers. */
  function decorate(r) {
    const mobile = vault.decrypt(r.mobile_enc) || '';
    const email  = vault.decrypt(r.email_enc) || '';
    return {
      id: r.id,
      sequence: r.id,
      created_at: r.created_at,
      name: vault.decrypt(r.name_enc),
      first_name: r.first_name_enc ? vault.decrypt(r.first_name_enc) : '',
      last_name:  r.last_name_enc  ? vault.decrypt(r.last_name_enc)  : '',
      mobile_masked: mobile ? mobile.slice(0, 4) + '•••' + mobile.slice(-3) : '',
      mobile, email,
      province: r.province, city: r.city, dealer: r.dealer,
      status: r.status,
      complete: !r.partial,
      lead_score: r.lead_score,
      age: r.age, segment: r.segment, drives: r.drives,
      intent: r.intent, budget: r.budget,
      model_interest: r.model_interest, ev_experience: r.ev_experience,
      consent_privacy: !!r.consent_privacy,
      consent_dealer: !!r.consent_dealer,
      consent_marketing: !!r.consent_marketing,
      utm_source: r.utm_source, utm_medium: r.utm_medium, utm_campaign: r.utm_campaign
    };
  }

  async function stats() {
    const one = async (sql, args = []) => {
      const r = await db.get(sql, args);
      return r ? Number(Object.values(r)[0]) : 0;
    };
    const [total, complete, partial, invited, claimed, dealerOk] = await Promise.all([
      one('SELECT COUNT(*) FROM registrations'),
      one('SELECT COUNT(*) FROM registrations WHERE partial=0'),
      one('SELECT COUNT(*) FROM registrations WHERE partial=1'),
      one("SELECT COUNT(*) FROM registrations WHERE status IN ('INVITED','CLAIMED','ATTENDED')"),
      one("SELECT COUNT(*) FROM registrations WHERE status IN ('CLAIMED','ATTENDED')"),
      one('SELECT COUNT(*) FROM registrations WHERE consent_dealer=1')
    ]);

    const daily = await db.all(
      `SELECT substr(created_at,1,10) AS day, COUNT(*) AS n
         FROM registrations GROUP BY day ORDER BY day DESC LIMIT 14`
    );
    const cities = await db.all(
      `SELECT city, COUNT(*) AS n FROM registrations GROUP BY city ORDER BY n DESC LIMIT 12`
    );
    const sources = await db.all(
      `SELECT COALESCE(utm_source,'direct') AS source, COUNT(*) AS n
         FROM registrations GROUP BY source ORDER BY n DESC LIMIT 12`
    );
    const intents = await db.all(
      `SELECT COALESCE(intent,'—') AS intent, COUNT(*) AS n
         FROM registrations WHERE partial=0 GROUP BY intent ORDER BY n DESC`
    );
    const pending = await one("SELECT COUNT(*) FROM comms_queue WHERE status='PENDING'");

    return {
      tiles: {
        total, complete, partial, invited, claimed, dealer_consented: dealerOk,
        claim_rate: invited ? Math.round((claimed / invited) * 100) : 0,
        comms_pending: pending
      },
      daily: daily.map(d => ({ day: d.day, n: Number(d.n) })).reverse(),
      cities: cities.map(c => ({ city: c.city, n: Number(c.n) })),
      sources: sources.map(s => ({ source: s.source, n: Number(s.n) })),
      intents: intents.map(i => ({ intent: i.intent, n: Number(i.n) }))
    };
  }

  /* ---------- selection + invitations ----------------------- */

  /* resend: false (default) will not queue a second invitation for
     someone who already has one with the same code — clicking
     Invite twice must not double-send email and SMS. Pass
     resend: true for a deliberate re-send. */
  async function invite(ids, hours = 72, resend = false) {
    const out = { invited: 0, skipped: 0, resent: 0, alreadySent: 0, codes: [] };
    for (const id of ids) {
      const reg = await db.get('SELECT * FROM registrations WHERE id=?', [id]);
      if (!reg || reg.partial) { out.skipped++; continue; }

      const existing = await db.get('SELECT code FROM invitations WHERE registration_id=?', [id]);
      let code = existing && existing.code;
      const sent = nowUTC();
      const expires = new Date(Date.now() + hours * 3600e3).toISOString().slice(0, 19).replace('T', ' ');

      if (!code) {
        code = 'XFN-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        await db.run(
          `INSERT INTO invitations (registration_id,code,sent_at,expires_at,status)
           VALUES (?,?,?,?, 'SENT')`,
          [id, code, sent, expires]
        );
      } else {
        await db.run("UPDATE invitations SET sent_at=?, expires_at=?, status='SENT' WHERE registration_id=?",
          [sent, expires, id]);
      }

      await db.run("UPDATE registrations SET status='INVITED', updated_at=? WHERE id=?", [sent, id]);

      const payload = JSON.stringify({ code, expires_at: expires });

      /* Has this exact code already gone out? */
      const priorMsgs = await db.all(
        "SELECT payload FROM comms_queue WHERE registration_id=? AND template='invitation'", [id]
      );
      const already = priorMsgs.some(m => {
        try { return JSON.parse(m.payload || '{}').code === code; } catch (e) { return false; }
      });

      if (already && !resend) {
        out.alreadySent++;
        out.codes.push({ id, code, expires_at: expires, queued: false });
        continue;                                 // status is already INVITED, nothing to send
      }

      for (const ch of ['email', 'sms']) {
        await db.run(
          `INSERT INTO comms_queue (registration_id,channel,template,recipient_enc,payload,created_at)
           VALUES (?,?,?,?,?,?)`,
          [id, ch, 'invitation', reg[ch === 'email' ? 'email_enc' : 'mobile_enc'], payload, sent]
        );
      }
      if (already) out.resent++; else out.invited++;
      out.codes.push({ id, code, expires_at: expires, queued: true });
    }
    return out;
  }

  /* Simulates the SM Tickets claim report (daily CSV or API). */
  async function markClaimed(code) {
    const inv = await db.get('SELECT * FROM invitations WHERE code=?', [code]);
    if (!inv) return { ok: false, reason: 'unknown code' };
    if (inv.claimed_at) return { ok: false, reason: 'already claimed' };
    if (inv.expires_at && inv.expires_at < nowUTC()) {
      await db.run("UPDATE invitations SET status='EXPIRED' WHERE id=?", [inv.id]);
      return { ok: false, reason: 'expired' };
    }
    const now = nowUTC();
    await db.run("UPDATE invitations SET claimed_at=?, status='CLAIMED' WHERE id=?", [now, inv.id]);
    await db.run("UPDATE registrations SET status='CLAIMED', updated_at=? WHERE id=?", [now, inv.registration_id]);
    return { ok: true, registration_id: inv.registration_id };
  }

  async function expireStale() {
    const now = nowUTC();
    const r = await db.run(
      "UPDATE invitations SET status='EXPIRED' WHERE claimed_at IS NULL AND expires_at<? AND status<>'EXPIRED'",
      [now]
    );
    return r.changes;
  }

  /* ---------- deletion --------------------------------------- */

  /* Every destructive action lands in export_log, which already
     carries actor / scope / count / filters — so deletions leave the
     same paper trail as exports. A DPA audit will ask for exactly
     this. */
  async function logAction(actor, scope, count, detail) {
    await db.run(
      'INSERT INTO export_log (at,actor,scope,dealer,row_count,filters) VALUES (?,?,?,?,?,?)',
      [nowUTC(), actor, scope, null, count, JSON.stringify(detail).slice(0, 2000)]
    );
  }

  /* Children first — the invitations FK would block the parent. */
  async function removeIds(ids) {
    let removed = 0;
    for (const id of ids) {
      await db.run('DELETE FROM comms_queue WHERE registration_id=?', [id]);
      await db.run('DELETE FROM invitations  WHERE registration_id=?', [id]);
      const r = await db.run('DELETE FROM registrations WHERE id=?', [id]);
      removed += r.changes;
    }
    return removed;
  }

  /* Hard delete. For test rows and mistakes — the record is gone and
     the sequence number is never reused. */
  async function deleteRegistrations(ids, actor) {
    const removed = await removeIds(ids);
    await logAction(actor, 'delete', removed, { ids });
    return { removed };
  }

  /* The right tool for a person exercising their DPA rights: the
     personal fields are erased, the row survives. Registration counts,
     the daily curve and reporting therefore stay honest — a hard
     delete would silently rewrite history.
     The unique hashes are replaced with random values so the record
     can never be re-linked to the person, and so the indexes still
     hold. */
  async function anonymise(ids, actor) {
    let done = 0;
    for (const id of ids) {
      const tag = 'erased-' + crypto.randomBytes(12).toString('hex');
      const r = await db.run(
        `UPDATE registrations SET
           name_enc=?, first_name_enc=NULL, last_name_enc=NULL,
           mobile_enc=?, email_enc=?,
           mobile_hash=?, email_hash=?,
           consent_dealer=0, consent_marketing=0, dealer=NULL,
           updated_at=?
         WHERE id=?`,
        [vault.encrypt('[erased]'), vault.encrypt(''), vault.encrypt(''),
         tag + '-m', tag + '-e', nowUTC(), id]
      );
      /* Anything still queued would carry their address out the door. */
      await db.run("DELETE FROM comms_queue WHERE registration_id=? AND status='PENDING'", [id]);
      done += r.changes;
    }
    await logAction(actor, 'anonymise', done, { ids });
    return { anonymised: done };
  }

  /* Seeded rows all use @example.com. The column is encrypted, so the
     domain cannot be matched in SQL — decrypt and filter in app. */
  async function purgeTestData(actor) {
    const rows = await db.all('SELECT id, email_enc FROM registrations');
    const ids = rows
      .filter(r => (vault.decrypt(r.email_enc) || '').toLowerCase().endsWith('@example.com'))
      .map(r => r.id);
    if (!ids.length) return { removed: 0, found: 0 };
    const removed = await removeIds(ids);
    await logAction(actor, 'purge-test', removed, { pattern: '@example.com' });
    return { removed, found: ids.length };
  }

  /* ---------- export ---------------------------------------- */

  const EXPORT_COLS = [
    'sequence','created_at','first_name','last_name','name','mobile','email','province','city','dealer','status',
    'lead_score','age','segment','drives','intent','budget','model_interest','ev_experience',
    'consent_dealer','consent_marketing','utm_source','utm_medium','utm_campaign'
  ];

  async function exportCsv(q, actor) {
    /* A dealer export is consent-gated at the query level, not in
       the UI — records without the dealer tick can never leak. */
    const scope = q.dealer ? 'dealer' : 'filtered';
    if (scope === 'dealer') q.consent_dealer = '1';

    const w = whereFrom(q);
    const rows = await db.all(
      `SELECT * FROM registrations ${w.sql} ORDER BY lead_score DESC, created_at ASC`, w.args
    );
    const data = rows.map(decorate);

    const esc = v => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = [EXPORT_COLS.join(',')]
      .concat(data.map(r => EXPORT_COLS.map(c => esc(r[c])).join(',')))
      .join('\r\n');

    await db.run(
      'INSERT INTO export_log (at,actor,scope,dealer,row_count,filters) VALUES (?,?,?,?,?,?)',
      [nowUTC(), actor, scope, q.dealer || null, data.length, JSON.stringify(q)]
    );

    return { csv, count: data.length };
  }

  async function exportLog() {
    return db.all('SELECT * FROM export_log ORDER BY at DESC LIMIT 50');
  }

  /* ---------- dealers + comms ------------------------------- */

  async function dealers() {
    return db.all('SELECT * FROM dealer_territories ORDER BY city');
  }

  async function setDealer(city, dealer) {
    const sql = db.upsertSql('dealer_territories', ['city', 'dealer'], 'city', ['dealer']);
    await db.run(sql, [city, dealer]);
    await db.run('UPDATE registrations SET dealer=? WHERE city=?', [dealer, city]);
  }

  async function comms(status) {
    const rows = await db.all(
      `SELECT * FROM comms_queue ${status ? 'WHERE status=?' : ''} ORDER BY id DESC LIMIT 100`,
      status ? [status] : []
    );
    return rows.map(r => ({
      id: r.id, registration_id: r.registration_id, channel: r.channel,
      template: r.template, status: r.status, attempts: r.attempts,
      created_at: r.created_at, sent_at: r.sent_at, error: r.error,
      recipient: vault.decrypt(r.recipient_enc),
      payload: r.payload ? JSON.parse(r.payload) : null
    }));
  }

  async function takePending(limit = 25) {
    return db.all("SELECT * FROM comms_queue WHERE status='PENDING' ORDER BY id LIMIT ?", [limit]);
  }

  async function markSent(id, error) {
    if (error) {
      await db.run("UPDATE comms_queue SET status='FAILED', attempts=attempts+1, error=? WHERE id=?",
        [String(error).slice(0, 500), id]);
    } else {
      await db.run("UPDATE comms_queue SET status='SENT', attempts=attempts+1, sent_at=? WHERE id=?",
        [nowUTC(), id]);
    }
  }

  async function rescoreAll() {
    const rows = await db.all('SELECT id, age, segment, drives, intent, budget, model_interest, ev_experience FROM registrations');
    for (const r of rows) {
      await db.run('UPDATE registrations SET lead_score=? WHERE id=?', [scoreOf(r), r.id]);
    }
    return rows.length;
  }

  return {
    deleteRegistrations, anonymise, purgeTestData,
    saveRegistration, publicCount, list, stats, invite, markClaimed, expireStale,
    exportCsv, exportLog, dealers, setDealer, comms, takePending, markSent,
    rescoreAll, decorate, nowUTC
  };
}

module.exports = { make };
