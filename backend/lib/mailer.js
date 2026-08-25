/* =============================================================
   Outbound email.

   Every message the campaign sends leaves from one identity, set in
   the env — MAIL_FROM — so the address is never buried in code:

     MAIL_FROM="XPENG Philippines <marketing@xpengphilippines.com>"

   Transport is SMTP via nodemailer, which is an optional dependency
   like mysql2: without SMTP settings the worker stays in dry-run and
   writes to backend/data/outbox.log instead. Hand-rolling SMTP auth,
   TLS and MIME for 20,000 messages would be the wrong kind of clever.
   ============================================================= */
'use strict';

function parseFrom(value) {
  /* Accepts either "Name <addr>" or a bare address. */
  const m = String(value || '').match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, ''), address: m[2] };
  return { name: '', address: String(value || '').trim() };
}

function make(env) {
  const from = parseFrom(env.MAIL_FROM || 'marketing@xpengphilippines.com');
  const replyTo = (env.MAIL_REPLY_TO || '').trim() || null;

  const host = (env.SMTP_HOST || '').trim();
  const configured = !!host;

  let transport = null;
  let lastError = null;

  function connect() {
    if (transport || !configured) return transport;
    let nodemailer;
    try {
      nodemailer = require('nodemailer');
    } catch (e) {
      lastError = 'nodemailer is not installed. Run: npm install nodemailer --prefix backend';
      return null;
    }
    const port = Number(env.SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host,
      port,
      /* 465 is implicit TLS; 587 upgrades with STARTTLS. Getting this
         wrong is the usual cause of a silent hang. */
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
      pool: true,
      maxConnections: Number(env.SMTP_POOL || 3),
      maxMessages: 100,
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 30000
    });
    return transport;
  }

  return {
    /* True when the worker should actually send rather than log. */
    enabled: configured,
    from,
    describe() {
      if (!configured) return 'dry run (no SMTP_HOST set)';
      return from.address + ' via ' + host + ':' + (env.SMTP_PORT || 587);
    },

    /* Proves the credentials before a campaign send, so a typo shows
       up now and not in the middle of 3,000 invitations. */
    async verify() {
      const t = connect();
      if (!t) return { ok: false, error: lastError || 'no transport' };
      try {
        await t.verify();
        return { ok: true, detail: this.describe() };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    async send({ to, subject, text, html }) {
      const t = connect();
      if (!t) throw new Error(lastError || 'mail transport not configured');
      const info = await t.sendMail({
        from: from.name ? { name: from.name, address: from.address } : from.address,
        replyTo: replyTo || undefined,
        to,
        subject,
        text,
        html,
        /* Campaign mail should never look like a reply thread, and
           bulk headers keep it out of Gmail's Promotions grouping
           less often than they help — but List-Unsubscribe is
           expected of anything sent at this volume. */
        headers: replyTo ? {} : {}
      });
      return { messageId: info.messageId, accepted: info.accepted };
    },

    async close() {
      if (transport && transport.close) transport.close();
    }
  };
}

module.exports = { make, parseFrom };
