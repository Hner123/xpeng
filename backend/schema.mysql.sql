-- =============================================================
-- XPENG FUTURE NIGHT — staging/production schema (MySQL 8)
-- Mirror of schema.sqlite.sql. Run once against an empty database:
--   mysql -u root -p xpeng_future_night < schema.mysql.sql
--
-- utf8mb4 throughout (Filipino names, ñ, emoji in free text).
-- Timestamps are stored as UTC DATETIME strings by the app; the
-- pool runs at +08:00 so admin day-filters match Manila days.
-- =============================================================

CREATE TABLE IF NOT EXISTS registrations (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_at           DATETIME NOT NULL,
  updated_at           DATETIME NOT NULL,

  /* Stored separately as well as combined: joining them is lossy —
     "Maria Clara Dela Cruz" cannot be split back reliably, and the
     comms need a first name to open with. */
  name_enc             VARBINARY(512) NOT NULL,
  first_name_enc       VARBINARY(256) DEFAULT NULL,
  last_name_enc        VARBINARY(256) DEFAULT NULL,
  mobile_enc           VARBINARY(256) NOT NULL,
  email_enc            VARBINARY(512) NOT NULL,

  mobile_hash          CHAR(64) NOT NULL,
  email_hash           CHAR(64) NOT NULL,

  province             VARCHAR(96)  NOT NULL,
  city                 VARCHAR(96)  NOT NULL,
  dealer               VARCHAR(96)  DEFAULT NULL,

  status               ENUM('REGISTERED','INVITED','CLAIMED','ATTENDED') NOT NULL DEFAULT 'REGISTERED',
  partial              TINYINT(1) NOT NULL DEFAULT 1,
  otp_verified         TINYINT(1) NOT NULL DEFAULT 0,
  lead_score           SMALLINT NOT NULL DEFAULT 0,

  age                  VARCHAR(24)  DEFAULT NULL,
  segment              VARCHAR(48)  DEFAULT NULL,
  drives               VARCHAR(48)  DEFAULT NULL,
  intent               VARCHAR(32)  DEFAULT NULL,
  budget               VARCHAR(32)  DEFAULT NULL,
  model_interest       VARCHAR(48)  DEFAULT NULL,
  ev_experience        VARCHAR(32)  DEFAULT NULL,

  consent_privacy      TINYINT(1) NOT NULL DEFAULT 0,
  consent_privacy_at   DATETIME DEFAULT NULL,
  consent_dealer       TINYINT(1) NOT NULL DEFAULT 0,
  consent_dealer_at    DATETIME DEFAULT NULL,
  consent_marketing    TINYINT(1) NOT NULL DEFAULT 0,
  consent_marketing_at DATETIME DEFAULT NULL,

  utm_source           VARCHAR(96)  DEFAULT NULL,
  utm_medium           VARCHAR(96)  DEFAULT NULL,
  utm_campaign         VARCHAR(128) DEFAULT NULL,
  utm_content          VARCHAR(128) DEFAULT NULL,
  utm_term             VARCHAR(128) DEFAULT NULL,
  click_id             VARCHAR(255) DEFAULT NULL,
  referrer             VARCHAR(255) DEFAULT NULL,
  landing_path         VARCHAR(128) DEFAULT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_mobile (mobile_hash),
  UNIQUE KEY uq_email  (email_hash),
  KEY ix_city (city),
  KEY ix_status (status),
  KEY ix_score (lead_score),
  KEY ix_created (created_at),
  KEY ix_source (utm_source),
  KEY ix_intent (intent)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invitations (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  registration_id BIGINT UNSIGNED NOT NULL,
  code            VARCHAR(32) NOT NULL,
  sent_at         DATETIME DEFAULT NULL,
  expires_at      DATETIME DEFAULT NULL,
  claimed_at      DATETIME DEFAULT NULL,
  status          ENUM('ISSUED','SENT','CLAIMED','EXPIRED') NOT NULL DEFAULT 'ISSUED',
  PRIMARY KEY (id),
  UNIQUE KEY uq_reg (registration_id),
  UNIQUE KEY uq_code (code),
  KEY ix_inv_status (status),
  CONSTRAINT fk_inv_reg FOREIGN KEY (registration_id) REFERENCES registrations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comms_queue (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  registration_id BIGINT UNSIGNED DEFAULT NULL,
  channel         ENUM('email','sms') NOT NULL,
  template        VARCHAR(48) NOT NULL,
  recipient_enc   VARBINARY(512) NOT NULL,
  payload         JSON DEFAULT NULL,
  status          ENUM('PENDING','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
  attempts        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL,
  sent_at         DATETIME DEFAULT NULL,
  error           TEXT,
  PRIMARY KEY (id),
  KEY ix_comms_status (status),
  KEY ix_comms_reg (registration_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dealer_territories (
  id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  city   VARCHAR(96) NOT NULL,
  dealer VARCHAR(96) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_city (city)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS export_log (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  at        DATETIME NOT NULL,
  actor     VARCHAR(96) NOT NULL,
  scope     VARCHAR(48) NOT NULL,
  dealer    VARCHAR(96) DEFAULT NULL,
  row_count INT UNSIGNED NOT NULL,
  filters   TEXT,
  PRIMARY KEY (id),
  KEY ix_export_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- admin accounts + sessions ----------
CREATE TABLE IF NOT EXISTS admin_users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(64) NOT NULL,
  display_name  VARCHAR(96) DEFAULT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','viewer') NOT NULL DEFAULT 'viewer',
  active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL,
  last_login_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  token_hash CHAR(64) NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  ip         VARCHAR(64) DEFAULT NULL,
  user_agent VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_token (token_hash),
  KEY ix_sess_expires (expires_at),
  CONSTRAINT fk_sess_user FOREIGN KEY (user_id) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
