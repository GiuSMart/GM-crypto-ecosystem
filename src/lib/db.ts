import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "./schema";
import { DEFAULT_SETTINGS, PLANS, REFERRALS, REFERRAL_UNCLASSIFIED, type EngineSettings } from "./config";
import { hashPassword, newId, randomToken } from "./crypto";
import { dbFile } from "./paths";

const globalForDb = globalThis as unknown as { __gmDb?: DatabaseSync };

export type Branding = {
  appName: string;
  logoMark: string;
  accent: string;
  tagline: string;
  supportEmail: string;
  footer: string;
};

export const DEFAULT_BRANDING: Branding = {
  appName: "GM CRYPTO ARBITRAGE AI",
  logoMark: "GM",
  accent: "#d4af37",
  tagline: "Net-profit arbitrage intelligence",
  supportEmail: "support@gmarbitrage.ai",
  footer: "© 2026 GM CRYPTO ARBITRAGE AI — software originale, licenza propria.",
};

/**
 * Seeds must never ship a password inside the repository.
 * GM_ADMIN_PASSWORD / GM_DEMO_PASSWORD win; otherwise a random one is generated
 * at first boot and printed to the server console exactly once.
 */
function bootstrapPassword(kind: "admin" | "demo", email: string): string {
  const generated = `Gm-${randomToken(9).replace(/[^A-Za-z0-9]/g, "").slice(0, 10)}-a1!`;
  console.warn(
    `[seed] Nessuna GM_${kind.toUpperCase()}_PASSWORD impostata: password iniziale per ${email} → ${generated}\n` +
      `[seed] Annotala ora, non verrà mostrata di nuovo. Cambiala al primo login.`,
  );
  return generated;
}

function seed(db: DatabaseSync) {
  const now = new Date().toISOString();

  // Engine defaults + branding
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)").run(
    "engine",
    JSON.stringify(DEFAULT_SETTINGS),
  );
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)").run(
    "branding",
    JSON.stringify(DEFAULT_BRANDING),
  );

  // Plans (prices configurable in the admin panel; payments hard-off until configured)
  const planStmt = db.prepare(
    `INSERT OR IGNORE INTO plans(id, name, price_cents, currency, interval, tagline, limits, features, active, payments_configured, sort)
     VALUES(?,?,?,?,?,?,?,?,1,0,?)`,
  );
  PLANS.forEach((p, i) => {
    planStmt.run(
      p.id,
      p.name,
      p.priceCents,
      p.currency,
      p.interval,
      p.tagline,
      JSON.stringify(p.limits),
      JSON.stringify(p.features),
      i * 10,
    );
  });

  // Referral catalogue. Existing rows are never touched: OR IGNORE only fills gaps.
  const refStmt = db.prepare(
    `INSERT OR IGNORE INTO referrals(id, platform, name, url, category, tagline, description, how_it_works, tutorial, terms, rewards, verified, affiliate_confirmed, accent, active, sort, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
  );
  REFERRALS.forEach((r, i) => {
    refStmt.run(
      r.id,
      r.platform,
      r.name,
      r.url,
      r.category,
      r.tagline,
      r.description,
      r.howItWorks,
      JSON.stringify(r.tutorial),
      r.terms,
      r.rewards,
      r.verified ? 1 : 0,
      r.affiliateConfirmed ? 1 : 0,
      r.accent,
      i * 10,
      now,
    );
  });

  // NOTE: use db.prepare().get() here, never one() — the helpers call getDb(),
  // which would re-enter seed().
  const exists = (id: string) => Boolean(db.prepare("SELECT id FROM users WHERE id = ?").get(id));
  const userStmt = db.prepare(
    `INSERT INTO users(id, email, password_hash, role, plan, display_name, status, must_change_password, created_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  );

  // Bootstrap administrator. Password must be changed at first login.
  if (!exists("usr_admin")) {
    const adminEmail = (process.env.GM_ADMIN_EMAIL ?? "admin@gmarbitrage.ai").toLowerCase();
    const adminPassword = process.env.GM_ADMIN_PASSWORD ?? bootstrapPassword("admin", adminEmail);
    userStmt.run("usr_admin", adminEmail, hashPassword(adminPassword), "admin", "premium", "Amministratore GM", "active", 1, now);
  }

  // A demo client isolates the multi-tenant paths for local testing.
  if (!exists("usr_demo")) {
    const demoPassword = process.env.GM_DEMO_PASSWORD ?? bootstrapPassword("demo", "cliente@demo.it");
    userStmt.run("usr_demo", "cliente@demo.it", hashPassword(demoPassword), "client", "free", "Cliente Demo", "active", 0, now);
  }

  db.prepare(
    `INSERT OR IGNORE INTO subscriptions(id, user_id, plan_id, status, started_at, note)
     VALUES(?,?,?,?,?,?)`,
  ).run(newId("sub"), "usr_demo", "free", "active", now, "Piano gratuito di default: nessun pagamento richiesto.");
}

/**
 * Forward-only migrations for databases created before a column existed.
 * Runs between SCHEMA_SQL (CREATE TABLE IF NOT EXISTS, which never alters an
 * existing table) and seed(), so the seed INSERT always finds the column.
 */
function migrate(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(referrals)").all() as unknown as { name: string }[];
  if (!columns.some((c) => c.name === "category")) {
    db.exec(`ALTER TABLE referrals ADD COLUMN category TEXT NOT NULL DEFAULT '${REFERRAL_UNCLASSIFIED}'`);
    // The ALTER writes its default into every existing row, so those rows carry
    // the fallback label without anyone having chosen it. Blanking them here
    // lets the backfill below give each offer its real category; this runs only
    // on the upgrade that adds the column, so a label an admin picks later is
    // never touched.
    db.prepare("UPDATE referrals SET category = ''").run();
  }

  // Paper trades stored their result without recording which formula produced
  // it. The ALTER default classifies every existing row as legacy, which is
  // accurate: they were closed before the transfer fee stopped being charged
  // twice. Their numbers are never recomputed or rewritten.
  const paperColumns = db.prepare("PRAGMA table_info(paper_trades)").all() as unknown as { name: string }[];
  if (!paperColumns.some((c) => c.name === "pnl_formula_version")) {
    db.exec("ALTER TABLE paper_trades ADD COLUMN pnl_formula_version INTEGER NOT NULL DEFAULT 1");
  }

  // Rows saved before categories existed, plus any row with an empty label, get
  // the seeded category when their id is known, otherwise the fallback bucket.
  // The WHERE clause makes this idempotent: a category an admin already chose is never overwritten.
  const backfill = db.prepare("UPDATE referrals SET category = ? WHERE id = ? AND (category IS NULL OR category = '')");
  REFERRALS.forEach((r) => backfill.run(r.category, r.id));
  db.prepare("UPDATE referrals SET category = ? WHERE category IS NULL OR category = ''").run(REFERRAL_UNCLASSIFIED);
}

export function getDb(): DatabaseSync {
  if (globalForDb.__gmDb) return globalForDb.__gmDb;
  const db = new DatabaseSync(dbFile());
  db.exec(SCHEMA_SQL);
  migrate(db);
  seed(db);
  globalForDb.__gmDb = db;
  return db;
}

/* -------------------------------------------------------------------------- */
/* Thin typed query helpers                                                    */
/* -------------------------------------------------------------------------- */

type Param = string | number | null | bigint | Uint8Array;

export function all<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[] {
  return getDb()
    .prepare(sql)
    .all(...params) as unknown as T[];
}

export function one<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | null {
  const rows = all<T>(sql, ...params);
  return rows.length ? rows[0] : null;
}

export function run(sql: string, ...params: Param[]) {
  return getDb()
    .prepare(sql)
    .run(...params);
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

function readJson<T>(key: string, fallback: T): T {
  const row = one<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  if (!row) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(row.value) as object) } as T;
  } catch {
    return fallback;
  }
}

export function getSettings(): EngineSettings {
  return readJson<EngineSettings>("engine", DEFAULT_SETTINGS);
}

export function saveSettings(patch: Partial<EngineSettings>): EngineSettings {
  const next = { ...getSettings(), ...patch };
  run("INSERT INTO settings(key, value) VALUES('engine', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(next));
  return next;
}

export function getBranding(): Branding {
  return readJson<Branding>("branding", DEFAULT_BRANDING);
}

export function saveBranding(patch: Partial<Branding>): Branding {
  const next = { ...getBranding(), ...patch };
  run("INSERT INTO settings(key, value) VALUES('branding', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(next));
  return next;
}

/** Per-user overrides layered on top of the global engine settings. */
export function getUserSettings(userId: string | null): EngineSettings {
  const base = getSettings();
  if (!userId) return base;
  const row = one<{ value: string }>("SELECT value FROM user_settings WHERE user_id = ? AND key = 'engine'", userId);
  if (!row) return base;
  try {
    return { ...base, ...(JSON.parse(row.value) as Partial<EngineSettings>) };
  } catch {
    return base;
  }
}

export function saveUserSettings(userId: string, patch: Partial<EngineSettings>): EngineSettings {
  const next = { ...getUserSettings(userId), ...patch };
  run(
    "INSERT INTO user_settings(user_id, key, value) VALUES(?, 'engine', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
    userId,
    JSON.stringify(next),
  );
  return next;
}

/* -------------------------------------------------------------------------- */
/* Fee overrides                                                               */
/* -------------------------------------------------------------------------- */

export type FeeOverride = { venue_id: string; maker_pct: number; taker_pct: number; note: string | null; updated_at: string };

export function getFeeOverride(venueId: string, userId: string | null): FeeOverride | null {
  if (userId) {
    const own = one<FeeOverride>(
      "SELECT venue_id, maker_pct, taker_pct, note, updated_at FROM fee_overrides WHERE venue_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 1",
      venueId,
      userId,
    );
    if (own) return own;
  }
  return one<FeeOverride>(
    "SELECT venue_id, maker_pct, taker_pct, note, updated_at FROM fee_overrides WHERE venue_id = ? AND user_id IS NULL ORDER BY updated_at DESC LIMIT 1",
    venueId,
  );
}

export function setFeeOverride(venueId: string, makerPct: number, takerPct: number, note: string, userId: string | null) {
  run(
    "INSERT INTO fee_overrides(id, user_id, venue_id, maker_pct, taker_pct, note, updated_at) VALUES(?,?,?,?,?,?,?)",
    newId("fee"),
    userId,
    venueId,
    makerPct,
    takerPct,
    note,
    new Date().toISOString(),
  );
}
