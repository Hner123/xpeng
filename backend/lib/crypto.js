/* =============================================================
   Field-level encryption for personal data (PH DPA, Section 10).

   Two operations, deliberately different:
   · encrypt()  — AES-256-GCM, random IV per value. Ciphertext for
                  the same input differs every time, so it CANNOT
                  be indexed or used for dedupe.
   · lookup()   — HMAC-SHA256, deterministic. Same input always
                  gives the same digest, so this is what carries
                  the UNIQUE index and what we dedupe on.

   Both keys derive from APP_KEY. Losing APP_KEY means losing the
   ability to read the table — back it up outside the database.
   ============================================================= */
'use strict';

const crypto = require('node:crypto');

const ALGO = 'aes-256-gcm';

function keys(appKey) {
  if (!appKey || appKey.length < 32) {
    throw new Error('APP_KEY must be at least 32 characters');
  }
  return {
    enc: crypto.hkdfSync('sha256', appKey, 'xpeng-fn-enc', 'encryption', 32),
    mac: crypto.hkdfSync('sha256', appKey, 'xpeng-fn-mac', 'lookup', 32)
  };
}

function make(appKey) {
  const k = keys(appKey);
  const encKey = Buffer.from(k.enc);
  const macKey = Buffer.from(k.mac);

  return {
    /* iv:tag:ciphertext, all base64 — one self-contained string. */
    encrypt(plain) {
      if (plain === null || plain === undefined) return null;
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv(ALGO, encKey, iv);
      const out = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
      return [iv.toString('base64'), c.getAuthTag().toString('base64'), out.toString('base64')].join(':');
    },

    decrypt(blob) {
      if (!blob) return null;
      try {
        const [iv, tag, data] = String(blob).split(':');
        const d = crypto.createDecipheriv(ALGO, encKey, Buffer.from(iv, 'base64'));
        d.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
      } catch (e) {
        return null;           // tampered or key rotated — never throw into a request
      }
    },

    /* Deterministic, for UNIQUE indexes and dedupe lookups. */
    lookup(value) {
      return crypto.createHmac('sha256', macKey)
        .update(String(value).trim().toLowerCase())
        .digest('hex');
    }
  };
}

module.exports = { make };
