-- HHC encrypted case DB (§7.3). Stores indicator-match / confidence / source / time
-- only. There is deliberately NO nationality/ethnicity column anywhere (design §0);
-- writes are additionally guarded by assertNoDemographicScoringFields.

CREATE TABLE IF NOT EXISTS subjects (
  subject_id     TEXT PRIMARY KEY,
  cluster_id     TEXT NOT NULL,
  identifiers    TEXT NOT NULL DEFAULT '{}',   -- JSON normalized identifiers (no demographics)
  norm_domain    TEXT NOT NULL DEFAULT '',
  norm_email     TEXT NOT NULL DEFAULT '',
  norm_phone     TEXT NOT NULL DEFAULT '',
  norm_company   TEXT NOT NULL DEFAULT '',
  first_seen     TEXT NOT NULL,
  last_seen      TEXT NOT NULL,
  inquiry_count  INTEGER NOT NULL DEFAULT 0,
  latest_band    TEXT,
  band_history   TEXT NOT NULL DEFAULT '[]'    -- JSON [{ts, band}]
);

CREATE TABLE IF NOT EXISTS inquiries (
  inquiry_id          TEXT PRIMARY KEY,
  subject_id          TEXT NOT NULL,
  cluster_id          TEXT NOT NULL,
  ts                  TEXT NOT NULL,
  input_fingerprint   TEXT,
  score               INTEGER NOT NULL,
  band                TEXT NOT NULL,
  matched_indicators  TEXT NOT NULL DEFAULT '[]',  -- JSON [id]
  theme               TEXT,
  evidence_ref        TEXT NOT NULL DEFAULT '[]'    -- JSON [key]
);

CREATE TABLE IF NOT EXISTS evidence_cache (
  cache_key         TEXT PRIMARY KEY,   -- subject_id|source|query
  subject_id        TEXT,
  source            TEXT NOT NULL,
  query             TEXT,
  result            TEXT,               -- JSON ToolRun
  fetched_at        TEXT NOT NULL,
  content_hash      TEXT,
  volatility_class  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inq_subject ON inquiries(subject_id);
CREATE INDEX IF NOT EXISTS idx_inq_ts ON inquiries(ts);
CREATE INDEX IF NOT EXISTS idx_subj_cluster ON subjects(cluster_id);
CREATE INDEX IF NOT EXISTS idx_subj_domain ON subjects(norm_domain);

-- ── Auth / accounts (Phase 1) ──────────────────────────────────────────────
-- Credentials live in this SQLCipher-encrypted DB (so HHC_AUTH requires HHC_DB_KEY).
-- No demographic columns; secrets are stored hashed/encrypted, never in plaintext.
-- These tables are deliberately EXCLUDED from the case .age export (exportImport.ts).

CREATE TABLE IF NOT EXISTS users (
  user_id              TEXT PRIMARY KEY,                 -- uuid
  email                TEXT NOT NULL UNIQUE,             -- login id, stored lowercased
  password_hash        TEXT NOT NULL,                    -- scrypt$N$r$p$saltB64$hashB64
  role                 TEXT NOT NULL DEFAULT 'user',     -- 'admin' | 'user'
  status               TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'disabled'
  mfa_method           TEXT NOT NULL DEFAULT 'none',     -- 'none' | 'totp' | 'email'
  mfa_enrolled         INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  must_enroll_mfa      INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  last_login_at        TEXT
);

CREATE TABLE IF NOT EXISTS mfa (
  user_id              TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  totp_secret_enc      TEXT,            -- base32 TOTP secret, AES-256-GCM wrapped
  totp_confirmed_at    TEXT,
  email_code_hash      TEXT,            -- sha256 of the current email OTP (never the code)
  email_code_expires   TEXT,
  email_code_sent_at   TEXT,
  email_code_attempts  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id           TEXT PRIMARY KEY,                 -- uuid
  user_id              TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash           TEXT NOT NULL UNIQUE,             -- sha256(raw cookie token)
  created_at           TEXT NOT NULL,
  last_seen_at         TEXT NOT NULL,                    -- idle timeout
  expires_at           TEXT NOT NULL,                    -- absolute expiry
  mfa_satisfied        INTEGER NOT NULL DEFAULT 0,       -- 1 after MFA (or method='none')
  user_agent           TEXT,
  ip                   TEXT
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  email                TEXT NOT NULL,
  ip                   TEXT,
  ts                   TEXT NOT NULL,
  success              INTEGER NOT NULL,
  reason               TEXT
);

-- ── Audit log (Phase 2) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  user_id     TEXT,
  email       TEXT,
  action      TEXT NOT NULL,
  route       TEXT NOT NULL,
  method      TEXT NOT NULL,
  status      INTEGER NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  geo_country TEXT,
  geo_region  TEXT,
  geo_city    TEXT,
  geo_status  TEXT,            -- 'ok' | 'unavailable' | 'error'
  detail      TEXT             -- safe, non-sensitive operation summary (no bodies/secrets)
);

-- Invitations: an admin "adds" a user → an emailed setup link (no initial password).
-- The raw token lives only in the link/email; the DB stores sha256(token).
CREATE TABLE IF NOT EXISTS invitations (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_ts ON login_attempts(email, ts);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_ts ON login_attempts(ip, ts);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
