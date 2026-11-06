/**
 * Additive SQLite schema for the AI Collective.
 *
 * Written as portable SQL (SQLite dialect) and applied with CREATE TABLE IF NOT
 * EXISTS, so running the migration twice is a no-op. It never alters a table
 * owned by the application schema (src/lib/schema.ts).
 */
export const AI_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_providers (
  provider_id            TEXT NOT NULL,
  model_id               TEXT NOT NULL,
  revision               TEXT NOT NULL,
  state                  TEXT NOT NULL,
  billing                TEXT NOT NULL,
  cost_per_request_eur   REAL NOT NULL DEFAULT 0,
  monthly_fixed_cost_eur REAL NOT NULL DEFAULT 0,
  requires_payment_card  INTEGER NOT NULL DEFAULT 0,
  automatic_paid_upgrade INTEGER NOT NULL DEFAULT 0,
  trains_on_free_tier    INTEGER NOT NULL DEFAULT 0,
  internal_data_approved INTEGER NOT NULL DEFAULT 0,
  local_model            INTEGER NOT NULL DEFAULT 0,
  requests_per_day       INTEGER NOT NULL,
  max_input_tokens       INTEGER NOT NULL,
  max_output_tokens      INTEGER NOT NULL,
  context_tokens         INTEGER NOT NULL,
  tools                  INTEGER NOT NULL DEFAULT 0,
  structured_output      INTEGER NOT NULL DEFAULT 0,
  evidence_url           TEXT NOT NULL,
  evidence_checked_at    TEXT NOT NULL,
  health                 TEXT NOT NULL DEFAULT 'unknown',
  region                 TEXT,
  licence                TEXT,
  review_note            TEXT,
  updated_at             TEXT NOT NULL,
  PRIMARY KEY (provider_id, model_id),
  CHECK (cost_per_request_eur >= 0),
  CHECK (monthly_fixed_cost_eur >= 0),
  CHECK (requests_per_day > 0),
  CHECK (max_input_tokens > 0),
  CHECK (max_output_tokens > 0),
  CHECK (state IN ('DISCOVERED','PENDING_REVIEW','APPROVED_FREE','QUOTA_EXHAUSTED','REVIEW_REQUIRED','SUSPENDED','REJECTED')),
  CHECK (billing IN ('FREE_NO_CARD','FREE_CARD_REQUIRED','UNKNOWN','PAID')),
  CHECK (health IN ('unknown','ok','failing'))
);

CREATE TABLE IF NOT EXISTS ai_quota (
  provider_id        TEXT NOT NULL,
  model_id           TEXT NOT NULL,
  window_start_ms    INTEGER NOT NULL,
  window_ms          INTEGER NOT NULL,
  used               INTEGER NOT NULL DEFAULT 0,
  limit_per_window   INTEGER NOT NULL,
  disabled_until_ms  INTEGER,
  disabled_code      TEXT,
  updated_at_ms      INTEGER NOT NULL,
  PRIMARY KEY (provider_id, model_id),
  CHECK (used >= 0),
  CHECK (limit_per_window >= 0),
  CHECK (window_ms > 0)
);

-- Shared rolling windows (per-minute request limits). Kept separate from ai_quota
-- so a global limit is never confused with a provider's daily quota.
CREATE TABLE IF NOT EXISTS ai_gate (
  gate_key         TEXT PRIMARY KEY,
  window_start_ms  INTEGER NOT NULL,
  window_ms        INTEGER NOT NULL,
  used             INTEGER NOT NULL DEFAULT 0,
  limit_per_window INTEGER NOT NULL,
  CHECK (used >= 0),
  CHECK (limit_per_window >= 0),
  CHECK (window_ms > 0)
);

CREATE TABLE IF NOT EXISTS ai_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  task_id     TEXT NOT NULL,
  action      TEXT NOT NULL,
  provider_id TEXT,
  model_id    TEXT,
  code        TEXT,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_audit_ts ON ai_audit(ts DESC);
CREATE INDEX IF NOT EXISTS idx_ai_providers_state ON ai_providers(state);
`;
