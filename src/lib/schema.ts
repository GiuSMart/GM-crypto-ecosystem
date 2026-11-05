/**
 * SQLite schema.
 *
 * Written as portable SQL (SQLite dialect) so it can be moved to PostgreSQL with
 * minimal edits: TEXT ids instead of SERIAL/UUID types, JSON stored as TEXT,
 * booleans as INTEGER. See docs/ARCHITECTURE.md for the migration notes.
 */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'client',      -- admin | client
  plan              TEXT NOT NULL DEFAULT 'free',        -- free | pro | premium
  display_name      TEXT NOT NULL,
  brand_name        TEXT,
  brand_accent      TEXT,
  status            TEXT NOT NULL DEFAULT 'active',      -- active | suspended
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_logins     INTEGER NOT NULL DEFAULT 0,
  locked_until      INTEGER,
  created_at        TEXT NOT NULL,
  last_login_at     TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,                          -- sha256 of the cookie token
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  revoked      INTEGER NOT NULL DEFAULT 0,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS fee_overrides (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,  -- NULL = global
  venue_id    TEXT NOT NULL,
  maker_pct   REAL NOT NULL,
  taker_pct   REAL NOT NULL,
  note        TEXT,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  venue_id            TEXT NOT NULL,
  label               TEXT NOT NULL,
  api_key_enc         TEXT NOT NULL,
  api_secret_enc      TEXT NOT NULL,
  permissions         TEXT NOT NULL DEFAULT 'read-only',
  withdrawals_enabled INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  last_checked_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);

CREATE TABLE IF NOT EXISTS wallets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL,
  label       TEXT NOT NULL,
  address     TEXT NOT NULL,
  chain       TEXT,
  mode        TEXT NOT NULL DEFAULT 'watch',   -- watch (address only) | connected
  balance_note TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);

CREATE TABLE IF NOT EXISTS pairs (
  id          TEXT PRIMARY KEY,               -- BASE/QUOTE
  base        TEXT NOT NULL,
  quote       TEXT NOT NULL,
  venues      TEXT NOT NULL,                  -- json array of venue ids
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunities (
  id             TEXT PRIMARY KEY,
  user_id        TEXT REFERENCES users(id) ON DELETE CASCADE,
  ts             TEXT NOT NULL,
  pair           TEXT NOT NULL,
  buy_venue      TEXT NOT NULL,
  sell_venue     TEXT NOT NULL,
  notional       REAL NOT NULL,
  buy_vwap       REAL NOT NULL,
  sell_vwap      REAL NOT NULL,
  top_buy        REAL NOT NULL,
  top_sell       REAL NOT NULL,
  gross_spread_pct REAL NOT NULL,
  fee_buy        REAL NOT NULL,
  fee_sell       REAL NOT NULL,
  transfer_cost  REAL NOT NULL,
  slippage_pct   REAL NOT NULL,
  buffer_cost    REAL NOT NULL,
  net_profit     REAL NOT NULL,
  margin_pct     REAL NOT NULL,
  executable     INTEGER NOT NULL,
  reject_reason  TEXT,
  data_age_ms    INTEGER NOT NULL,
  payload        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opps_ts ON opportunities(ts DESC);
CREATE INDEX IF NOT EXISTS idx_opps_pair ON opportunities(pair, ts DESC);
CREATE INDEX IF NOT EXISTS idx_opps_user ON opportunities(user_id, ts DESC);

CREATE TABLE IF NOT EXISTS scan_runs (
  id           TEXT PRIMARY KEY,
  ts           TEXT NOT NULL,
  venues       TEXT NOT NULL,
  pairs        INTEGER NOT NULL,
  candidates   INTEGER NOT NULL,
  executable   INTEGER NOT NULL,
  best_margin  REAL,
  errors       TEXT,
  duration_ms  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_trades (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id  TEXT,
  pair            TEXT NOT NULL,
  buy_venue       TEXT NOT NULL,
  sell_venue      TEXT NOT NULL,
  notional        REAL NOT NULL,
  qty             REAL NOT NULL,
  buy_vwap        REAL NOT NULL,
  sell_vwap       REAL NOT NULL,
  fee_buy         REAL NOT NULL,
  fee_sell        REAL NOT NULL,
  other_costs     REAL NOT NULL DEFAULT 0,
  expected_profit REAL NOT NULL,
  expected_margin_pct REAL NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open',  -- open | closed
  opened_at       TEXT NOT NULL,
  closed_at       TEXT,
  exit_buy        REAL,
  exit_sell       REAL,
  realized_profit REAL,
  realized_margin_pct REAL,
  pnl_formula_version INTEGER NOT NULL DEFAULT 1,  -- P&L formula used at close; 2 = current, 1 = legacy
  note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_paper_user ON paper_trades(user_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS referrals (
  id           TEXT PRIMARY KEY,
  platform     TEXT NOT NULL,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'Altro / Non classificato',   -- see REFERRAL_CATEGORIES in config.ts
  tagline      TEXT,
  description  TEXT,
  how_it_works TEXT,
  tutorial     TEXT,      -- json array
  terms        TEXT,
  rewards      TEXT,
  verified     INTEGER NOT NULL DEFAULT 0,
  affiliate_confirmed INTEGER NOT NULL DEFAULT 0,
  accent       TEXT DEFAULT 'gold',
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 100,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'EUR',
  interval    TEXT NOT NULL DEFAULT 'month',
  tagline     TEXT,
  limits      TEXT,   -- json
  features    TEXT,   -- json
  active      INTEGER NOT NULL DEFAULT 1,
  payments_configured INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'inactive',  -- inactive | trialing | active | past_due
  started_at    TEXT,
  current_period_end TEXT,
  note          TEXT
);

CREATE TABLE IF NOT EXISTS live_authorizations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by  TEXT NOT NULL,
  granted_at  TEXT NOT NULL,
  revoked_at  TEXT,
  max_order_quote REAL NOT NULL,
  max_daily_loss_quote REAL NOT NULL,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id      TEXT PRIMARY KEY,
  ts      TEXT NOT NULL,
  user_id TEXT,
  action  TEXT NOT NULL,
  target  TEXT,
  meta    TEXT,
  ip      TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
`;
