-- =============================================================
-- XPENG FUTURE NIGHT — local/dev schema (SQLite)
-- Mirrors schema.mysql.sql. Keep the two in step: every column
-- here exists there, with the same name and meaning.
--
-- Personal fields (name, mobile, email) are stored encrypted.
-- Dedupe cannot index ciphertext, so each has a deterministic
-- HMAC hash column carrying the UNIQUE index.
-- =============================================================

CREATE TABLE IF NOT EXISTS registrations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,   -- doubles as the public sequence number
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,

  -- encrypted personal data (AES-256-GCM)
  name_enc            TEXT NOT NULL,
  mobile_enc          TEXT NOT NULL,
  email_enc           TEXT NOT NULL,

  -- deterministic lookup keys (HMAC-SHA256) — these carry the unique indexes
  mobile_hash         TEXT NOT NULL UNIQUE,
  email_hash          TEXT NOT NULL UNIQUE,

  -- dealer territory keys (not personal data, safe to index and filter)
  province            TEXT NOT NULL,
  city                TEXT NOT NULL,
  dealer              TEXT,

  -- pipeline
  status              TEXT NOT NULL DEFAULT 'REGISTERED',  -- REGISTERED|INVITED|CLAIMED|ATTENDED
  partial             INTEGER NOT NULL DEFAULT 1,          -- 1 = Step 1 only, 0 = qualified
  otp_verified        INTEGER NOT NULL DEFAULT 0,
  lead_score          INTEGER NOT NULL DEFAULT 0,

  -- Step 2 answers, as real columns so admin can filter and export on them
  age                 TEXT,
  segment             TEXT,
  drives              TEXT,
  intent              TEXT,
  budget              TEXT,
  model_interest      TEXT,
  ev_experience       TEXT,

  -- consents, each with its own timestamp (PH DPA)
  consent_privacy     INTEGER NOT NULL DEFAULT 0,
  consent_privacy_at  TEXT,
  consent_dealer      INTEGER NOT NULL DEFAULT 0,
  consent_dealer_at   TEXT,
  consent_marketing   INTEGER NOT NULL DEFAULT 0,
  consent_marketing_at TEXT,

  -- attribution
  utm_source          TEXT,
  utm_medium          TEXT,
  utm_campaign        TEXT,
  utm_content         TEXT,
  utm_term            TEXT,
  click_id            TEXT,
  referrer            TEXT,
  landing_path        TEXT
);

CREATE INDEX IF NOT EXISTS ix_reg_city    ON registrations(city);
CREATE INDEX IF NOT EXISTS ix_reg_status  ON registrations(status);
CREATE INDEX IF NOT EXISTS ix_reg_score   ON registrations(lead_score);
CREATE INDEX IF NOT EXISTS ix_reg_created ON registrations(created_at);
CREATE INDEX IF NOT EXISTS ix_reg_source  ON registrations(utm_source);
CREATE INDEX IF NOT EXISTS ix_reg_intent  ON registrations(intent);

CREATE TABLE IF NOT EXISTS invitations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER NOT NULL UNIQUE REFERENCES registrations(id),
  code          TEXT NOT NULL UNIQUE,
  sent_at       TEXT,
  expires_at    TEXT,                                  -- sent_at + 72h
  claimed_at    TEXT,
  status        TEXT NOT NULL DEFAULT 'ISSUED'         -- ISSUED|SENT|CLAIMED|EXPIRED
);
CREATE INDEX IF NOT EXISTS ix_inv_status ON invitations(status);

CREATE TABLE IF NOT EXISTS comms_queue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER REFERENCES registrations(id),
  channel       TEXT NOT NULL,                          -- email|sms
  template      TEXT NOT NULL,                          -- waitlist_confirmation|invitation|...
  recipient_enc TEXT NOT NULL,
  payload       TEXT,
  status        TEXT NOT NULL DEFAULT 'PENDING',        -- PENDING|SENT|FAILED
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  sent_at       TEXT,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS ix_comms_status ON comms_queue(status);

CREATE TABLE IF NOT EXISTS dealer_territories (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  city    TEXT NOT NULL UNIQUE,
  dealer  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS export_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL,
  scope      TEXT NOT NULL,
  dealer     TEXT,
  row_count  INTEGER NOT NULL,
  filters    TEXT
);

-- ---------- admin accounts + sessions ----------
-- Passwords are scrypt hashes (salt stored with the hash).
-- Roles: admin = full access · viewer = read-only, no personal-data export.
CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

-- Only a hash of the session token is stored, so a database dump
-- cannot be replayed as a live session.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES admin_users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS ix_sess_expires ON admin_sessions(expires_at);
