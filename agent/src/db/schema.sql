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
