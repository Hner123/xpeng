/* =============================================================
   Outbound SMS — Semaphore (https://semaphore.co).

   Same contract as lib/mailer.js: without SEMAPHORE_API_KEY the
   worker stays in dry-run and writes to backend/data/outbox.log,
   so the pipeline is observable without sending anything.

   Semaphore is a local aggregator, which matters here for two
   reasons: PH termination costs roughly 1/20th of a global CPaaS,
   and the sender name they have already registered with Globe /
   Smart / DITO can be used on day one. An UNREGISTERED sender name
   is rejected by the API — the carriers block unregistered A2P
   traffic, so this is not something a provider can waive.

   No dependency: Node 22 ships global fetch.
   ============================================================= */
'use strict';

const BASE = 'https://api.semaphore.co/api/v4';

/* Semaphore rate-limits /messages to 120 calls per minute. The comms
   worker takes 25 messages per 10s tick, which would be 150/min at one
   call each — over the limit under launch load, though never during a
   quiet test. Space the calls so we cannot exceed it. */
const MIN_GAP_MS = 500;              // 60_000 / 120

/* The API accepts 09XXXXXXXXX and +63XXXXXXXXXX. Records are stored
   normalised to 09XXXXXXXXX already; this is belt and braces for any
   older row. */
function normalise(number) {
  let d = String(number == null ? '' : number).replace(/[^\d]/g, '');
  if (d.startsWith('63')) d = '0' + d.slice(2);
  if (d.startsWith('9') && d.length === 10) d = '0' + d;
  return d;
}

function make(env) {
  const apikey = (env.SEMAPHORE_API_KEY || '').trim();
  const sender = (env.SMS_SENDER_NAME || '').trim();
  const base = (env.SEMAPHORE_BASE_URL || BASE).replace(/\/$/, '');
  const configured = !!apikey;

  /* Templates whose delivery is time-critical can go through the
     priority queue, which costs TWO credits per 160 characters
     instead of one. Off by default: doubling the bill should be a
     decision, not something that happens quietly. */
  const priorityTemplates = String(env.SMS_PRIORITY_TEMPLATES || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  let nextSlot = 0;

  async function pace() {
    const wait = nextSlot - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    nextSlot = Date.now() + MIN_GAP_MS;
  }

  async function call(path, params) {
    const body = new URLSearchParams(Object.assign({ apikey }, params));
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000)
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* non-JSON error page */ }

    if (res.status === 429) {
      /* Back off and let the queue retry rather than hammering. */
      const retry = res.headers.get('Retry-After') || '60';
      nextSlot = Date.now() + Number(retry) * 1000;
      throw new Error('rate limited, retry after ' + retry + 's');
    }
    if (!res.ok) {
      throw new Error('semaphore ' + res.status + ': ' + describeError(data, text));
    }
    /* A 200 can still carry a field-validation object rather than the
       array of queued messages — an unregistered sendername comes back
       this way. Treat it as a failure so the row retries visibly
       instead of being marked sent. */
    if (!Array.isArray(data)) {
      throw new Error('semaphore rejected: ' + describeError(data, text));
    }
    return data;
  }

  function describeError(data, raw) {
    if (data && typeof data === 'object') {
      const parts = [];
      for (const [field, msgs] of Object.entries(data)) {
        parts.push(field + ': ' + (Array.isArray(msgs) ? msgs.join(' ') : msgs));
      }
      if (parts.length) return parts.join('; ');
    }
    return String(raw || '').slice(0, 200);
  }

  return {
    /* True when the worker should actually send rather than log. */
    enabled: configured,
    sender,

    describe() {
      if (!configured) return 'dry run (no SEMAPHORE_API_KEY set)';
      return 'Semaphore' + (sender ? ' as "' + sender + '"' : ' (account default sender)');
    },

    /* Proves the key and reports remaining credit, so a dead account
       shows up at boot rather than halfway through an invitation run. */
    async verify() {
      if (!configured) return { ok: false, error: 'no SEMAPHORE_API_KEY' };
      try {
        const res = await fetch(base + '/account?apikey=' + encodeURIComponent(apikey),
          { signal: AbortSignal.timeout(15_000) });
        const data = await res.json();
        if (!res.ok || !data || data.apikey) {
          return { ok: false, error: describeError(data, '') || ('HTTP ' + res.status) };
        }
        const acct = Array.isArray(data) ? data[0] : data;
        return {
          ok: true,
          credits: Number(acct.credit_balance || 0),
          detail: this.describe() + ' — ' + (acct.credit_balance || 0) + ' credits'
        };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    /* One message. Throws on failure so the caller records the error
       and the row is retried by the queue. */
    async send({ to, text, template }) {
      if (!configured) throw new Error('SMS transport not configured');
      const number = normalise(to);
      if (!/^09\d{9}$/.test(number)) throw new Error('not a PH mobile number: ' + to);

      const priority = template && priorityTemplates.includes(template);
      await pace();
      const rows = await call(priority ? '/priority' : '/messages', Object.assign(
        { number, message: text }, sender ? { sendername: sender } : {}));

      const first = rows[0] || {};
      return {
        messageId: first.message_id,
        status: first.status,
        network: first.network,
        priority: !!priority
      };
    },

    async balance() {
      const v = await this.verify();
      return v.ok ? v.credits : null;
    }
  };
}

module.exports = { make, normalise };
