/* =============================================================
   Input validation for the public write path.
   Server-side truth: the page's client-side checks are UX only.
   ============================================================= */
'use strict';

const RE_MOBILE = /^09\d{9}$/;
const RE_EMAIL  = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/* Chip/dropdown answers must match the offered options — never
   trust a value that came back from the browser. */
const ALLOWED = {
  age:    ['18–24','25–34','35–44','45–54','55+'],
  segment:['Business owner','Professional / employee','Government','OFW / OFW family','Student','Other'],
  intent: ['Within 3 months','3–6 months','6–12 months','Over a year','Just exploring'],
  budget: ['Under ₱1.5M','₱1.5–2.5M','₱2.5–4M','₱4M+','Prefer not to say'],
  model:  ['X9 luxury MPV','L03 SUV','The full line-up','Just curious about the AI'],
  ev:     ['Own an EV','Have test-driven','Never tried']
};

function normaliseMobile(v) {
  let d = String(v == null ? '' : v).replace(/[^\d]/g, '');
  if (d.startsWith('63')) d = '0' + d.slice(2);
  if (d.startsWith('9') && d.length === 10) d = '0' + d;
  return d;
}

function str(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function validate(body, geo) {
  const errors = [];
  const out = {};

  out.name = str(body.name, 120);
  if (out.name.length < 2) errors.push('name');

  out.mobile = normaliseMobile(body.mobile);
  if (!RE_MOBILE.test(out.mobile)) errors.push('mobile');

  out.email = str(body.email, 190).toLowerCase();
  if (!RE_EMAIL.test(out.email)) errors.push('email');

  out.province = str(body.province, 96);
  out.city = str(body.city, 96);

  /* City drives dealer assignment, so it must be a value we offered
     — not free text that no territory map can match. */
  if (geo) {
    if (!geo[out.province]) errors.push('province');
    else if (!geo[out.province].includes(out.city)) errors.push('city');
  } else {
    if (!out.province) errors.push('province');
    if (!out.city) errors.push('city');
  }

  out.partial = body.partial !== false;

  const p = body.profile || {};
  const pick = (key, val) => {
    const v = str(val, 48);
    return ALLOWED[key].includes(v) ? v : null;
  };
  out.profile = {
    age:     pick('age', p.age),
    segment: pick('segment', p.segment),
    drives:  str(p.drives, 48) || null,
    intent:  pick('intent', p.intent),
    budget:  pick('budget', p.budget),
    model:   pick('model', p.model),
    ev:      pick('ev', p.ev)
  };

  const c = body.consents || {};
  out.consents = {
    privacy: !!c.privacy,
    dealer: !!c.dealer,
    marketing: !!c.marketing,
    at: null                       // stamped server-side, never client-supplied
  };

  /* A completed registration requires the privacy consent. */
  if (!out.partial && !out.consents.privacy) errors.push('consent_privacy');

  const u = body.utm || {};
  out.utm = {};
  ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','ttclid','gclid','referrer','landing_path']
    .forEach(k => { if (u[k]) out.utm[k] = str(u[k], 255); });

  return { ok: errors.length === 0, errors, value: out };
}

module.exports = { validate, normaliseMobile, ALLOWED };
