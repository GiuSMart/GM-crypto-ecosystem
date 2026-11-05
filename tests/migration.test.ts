import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/* -------------------------------------------------------------------------- */
/* Test runtime                                                                */
/* -------------------------------------------------------------------------- */

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-migration-"));
process.env.GM_DATA_DIR = runtimeDir;
process.env.GM_DB_PATH = path.join(runtimeDir, "legacy.db");
process.env.GM_ADMIN_PASSWORD = "Admin-Migration-Test-a1!";
process.env.GM_DEMO_PASSWORD = "Demo-Migration-Test-a1!";

// Imported in a hook: src/lib/db reads GM_DB_PATH when it opens, and tsx
// compiles these tests as CommonJS where top-level await is unavailable.
type Db = import("node:sqlite").DatabaseSync;
let getDb: () => Db;
let REFERRALS: readonly { id: string; name: string; category: string }[];
let REFERRAL_UNCLASSIFIED: string;

test.before(async () => {
  ({ getDb } = await import("../src/lib/db"));
  ({ REFERRALS, REFERRAL_UNCLASSIFIED } = await import("../src/lib/config"));
});

test.after(() => {
  try {
    getDb().close();
  } catch {
    // already closed
  }
  fs.rmSync(runtimeDir, { recursive: true, force: true });
});

/** Re-open through getDb(), dropping the process-wide cache first. */
function reopen(file: string) {
  try {
    getDb().close();
  } catch {
    // already closed
  }
  delete (globalThis as unknown as { __gmDb?: Db }).__gmDb;
  process.env.GM_DB_PATH = file;
  return getDb();
}

const columnsOf = (db: Db) =>
  (db.prepare("PRAGMA table_info(referrals)").all() as unknown as { name: string }[]).map((c) => c.name);

const categoryOf = (db: Db, id: string) =>
  (db.prepare("SELECT category FROM referrals WHERE id = ?").get(id) as { category: string } | undefined)?.category ?? null;

const referralIds = (db: Db) =>
  (db.prepare("SELECT id FROM referrals ORDER BY id").all() as unknown as { id: string }[]).map((r) => r.id);

/* -------------------------------------------------------------------------- */
/* A database written before categories existed                                */
/* -------------------------------------------------------------------------- */

/**
 * The pre-category table, column for column as it shipped. CREATE TABLE IF NOT
 * EXISTS cannot alter it, so this is exactly what an operator upgrading from an
 * older release has on disk.
 */
const LEGACY_REFERRALS_SQL = `
CREATE TABLE referrals (
  id           TEXT PRIMARY KEY,
  platform     TEXT NOT NULL,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,
  tagline      TEXT,
  description  TEXT,
  how_it_works TEXT,
  tutorial     TEXT,
  terms        TEXT,
  rewards      TEXT,
  verified     INTEGER NOT NULL DEFAULT 0,
  affiliate_confirmed INTEGER NOT NULL DEFAULT 0,
  accent       TEXT DEFAULT 'gold',
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 100,
  updated_at   TEXT NOT NULL
);
`;

function writeLegacyDb(file: string) {
  const legacy = new DatabaseSync(file);
  legacy.exec(LEGACY_REFERRALS_SQL);
  const insert = legacy.prepare(
    `INSERT INTO referrals(id, platform, name, url, tagline, description, how_it_works, tutorial, terms, rewards, verified, affiliate_confirmed, accent, active, sort, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  // A seeded id that predates categories: its category is known from config.
  insert.run("kraken", "Kraken", "Kraken Pro (storico)", "https://invite.kraken.com/JDNW/b0zu2lzt", null, null, null, "[]", null, null, 1, 1, "gold", 1, 5, "2026-01-01T00:00:00.000Z");
  // An offer the owner added by hand and config knows nothing about.
  insert.run("legacy-offer", "Legacy", "Offerta storica", "https://legacy.example/ref", null, null, null, "[]", null, null, 0, 0, "gold", 0, 500, "2026-01-02T00:00:00.000Z");
  legacy.close();
}

test("an older database gains the category column and keeps its rows", () => {
  const file = path.join(runtimeDir, "legacy.db");
  writeLegacyDb(file);

  const db = reopen(file);

  assert.ok(columnsOf(db).includes("category"), "la migrazione deve aggiungere la colonna category");
  assert.equal(
    columnsOf(db).filter((c) => c === "category").length,
    1,
    "la colonna non deve essere aggiunta due volte",
  );

  const kraken = REFERRALS.find((r) => r.id === "kraken");
  assert.ok(kraken);
  assert.equal(categoryOf(db, "kraken"), kraken.category, "un id noto deve tornare alla categoria del catalogo");
  assert.equal(
    categoryOf(db, "legacy-offer"),
    REFERRAL_UNCLASSIFIED,
    "un'offerta fuori catalogo finisce nel raggruppamento di riserva, non in una categoria inventata",
  );

  // Nothing is dropped or rewritten: the ids and the owner's data survive.
  assert.ok(referralIds(db).includes("legacy-offer"));
  const legacy = db.prepare("SELECT name, url, active FROM referrals WHERE id = 'legacy-offer'").get() as {
    name: string;
    url: string;
    active: number;
  };
  assert.equal(legacy.name, "Offerta storica");
  assert.equal(legacy.url, "https://legacy.example/ref");
  assert.equal(legacy.active, 0, "un'offerta spenta deve restare spenta");

  // The seed only fills the gaps: 2 legacy rows + the 6 seeded ids still missing.
  assert.equal(referralIds(db).length, REFERRALS.length + 1);
  assert.equal(referralIds(db).filter((id) => id === "kraken").length, 1, "il seed non deve duplicare una riga esistente");
});

test("re-running the migration is harmless and never overwrites a chosen category", () => {
  const db = getDb();
  // What an admin does in the panel: pick a category of their own.
  db.prepare("UPDATE referrals SET category = ? WHERE id = 'kraken'").run("Finanza / Exchange");
  db.prepare("UPDATE referrals SET category = ? WHERE id = 'wirex'").run("Mia categoria");
  // And an empty label left behind by an older write.
  db.prepare("UPDATE referrals SET category = '' WHERE id = 'coinbase'").run();
  const before = referralIds(db).length;

  const again = reopen(process.env.GM_DB_PATH ?? "");

  assert.equal(categoryOf(again, "kraken"), "Finanza / Exchange");
  assert.equal(
    categoryOf(again, "wirex"),
    "Mia categoria",
    "una categoria scelta dall'admin non deve essere riallineata al seed",
  );
  assert.equal(
    categoryOf(again, "coinbase"),
    REFERRALS.find((r) => r.id === "coinbase")?.category,
    "una categoria vuota deve essere ripristinata dal catalogo",
  );
  assert.equal(referralIds(again).length, before, "nessuna riga deve essere creata o persa");
  assert.equal(columnsOf(again).filter((c) => c === "category").length, 1);
});

/* -------------------------------------------------------------------------- */
/* A brand-new database                                                        */
/* -------------------------------------------------------------------------- */

test("a fresh database is created with the full referral catalogue", () => {
  const file = path.join(runtimeDir, "fresh.db");
  const db = reopen(file);

  const columns = columnsOf(db);
  for (const column of ["id", "platform", "name", "url", "category", "active", "sort", "updated_at"]) {
    assert.ok(columns.includes(column), `colonna ${column} mancante`);
  }

  const rows = db.prepare("SELECT id, name, url, category, active FROM referrals ORDER BY sort ASC, name ASC").all() as unknown as {
    id: string;
    name: string;
    url: string;
    category: string;
    active: number;
  }[];

  assert.equal(rows.length, REFERRALS.length);
  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    REFERRALS.map((r) => r.id).sort(),
  );
  for (const row of rows) {
    assert.ok(row.category.trim().length > 0, `${row.id} senza categoria`);
    assert.equal(row.category, REFERRALS.find((r) => r.id === row.id)?.category);
    assert.ok(row.url.startsWith("https://"));
    assert.equal(row.active, 1);
  }
});

/* -------------------------------------------------------------------------- */
/* Paper trades written before the P&L formula was recorded                   */
/* -------------------------------------------------------------------------- */

/**
 * The paper_trades table as it shipped before column versioning, minus the
 * foreign key: the fixture runs before users are seeded, and the point of this
 * table is the missing column, not the constraint graph.
 */
const LEGACY_PAPER_SQL = `
CREATE TABLE paper_trades (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
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
  status          TEXT NOT NULL DEFAULT 'open',
  opened_at       TEXT NOT NULL,
  closed_at       TEXT,
  exit_buy        REAL,
  exit_sell       REAL,
  realized_profit REAL,
  realized_margin_pct REAL,
  note            TEXT
);
`;

/** Insert a trade, optionally declaring the formula that produced its result. */
function insertPaperRow(db: Db, id: string, realized: number | null, version?: number) {
  const columns = [
    "id", "user_id", "pair", "buy_venue", "sell_venue", "notional", "qty", "buy_vwap", "sell_vwap",
    "fee_buy", "fee_sell", "expected_profit", "expected_margin_pct", "status", "opened_at", "closed_at",
    "realized_profit", "realized_margin_pct",
  ];
  const values: (string | number | null)[] = [
    id, "usr_admin", "BTC/EUR", "kraken", "coinbase", 500, 0.0071, 70_000, 70_050,
    1.1, 1.4, 12.5, 2.5, realized === null ? "open" : "closed", "2026-01-01T10:00:00.000Z",
    realized === null ? null : "2026-01-02T10:00:00.000Z", realized, realized === null ? null : 2.5,
  ];
  if (version !== undefined) {
    columns.push("pnl_formula_version");
    values.push(version);
  }
  db.prepare(`INSERT INTO paper_trades(${columns.join(", ")}) VALUES(${columns.map(() => "?").join(",")})`).run(...values);
}

const paperColumnsOf = (db: Db) =>
  (db.prepare("PRAGMA table_info(paper_trades)").all() as unknown as { name: string }[]).map((c) => c.name);

const paperRow = (db: Db, id: string) =>
  db.prepare("SELECT status, realized_profit, pnl_formula_version FROM paper_trades WHERE id = ?").get(id) as
    | { status: string; realized_profit: number | null; pnl_formula_version: number }
    | undefined;

function writeLegacyPaperDb(file: string) {
  const legacy = new DatabaseSync(file);
  legacy.exec(LEGACY_PAPER_SQL);
  // Results produced by the formula that charged the withdrawal fee twice.
  insertPaperRow(legacy, "pt_legacy_closed", -12.5);
  insertPaperRow(legacy, "pt_legacy_win", 3.25);
  insertPaperRow(legacy, "pt_legacy_open", null);
  legacy.close();
}

test("an older database gains pnl_formula_version and keeps its results untouched", () => {
  const file = path.join(runtimeDir, "legacy-paper.db");
  writeLegacyPaperDb(file);

  const db = reopen(file);

  assert.ok(paperColumnsOf(db).includes("pnl_formula_version"), "la migrazione deve aggiungere la colonna pnl_formula_version");
  assert.equal(
    paperColumnsOf(db).filter((c) => c === "pnl_formula_version").length,
    1,
    "la colonna non deve essere aggiunta due volte",
  );

  // Every pre-existing row is historical by definition, and its number is the
  // one that was stored: the migration classifies, it never recomputes.
  const lost = paperRow(db, "pt_legacy_closed");
  assert.equal(lost?.pnl_formula_version, 1);
  assert.equal(lost?.realized_profit, -12.5);
  assert.equal(lost?.status, "closed");
  assert.equal(paperRow(db, "pt_legacy_win")?.realized_profit, 3.25);
  assert.equal(paperRow(db, "pt_legacy_open")?.realized_profit, null, "una posizione aperta non deve ricevere un risultato");
  assert.equal(paperRow(db, "pt_legacy_open")?.pnl_formula_version, 1);

  // The migration is idempotent: reopening changes nothing.
  const again = reopen(file);
  assert.equal(paperColumnsOf(again).filter((c) => c === "pnl_formula_version").length, 1);
  assert.equal(paperRow(again, "pt_legacy_closed")?.realized_profit, -12.5);
  assert.equal(paperRow(again, "pt_legacy_closed")?.pnl_formula_version, 1);
});

test("a new trade records the current formula, and the default stays legacy", () => {
  const db = getDb();

  insertPaperRow(db, "pt_v2", 7.5, 2);
  assert.equal(paperRow(db, "pt_v2")?.pnl_formula_version, 2);
  assert.equal(paperRow(db, "pt_v2")?.realized_profit, 7.5);

  // A write that does not name a version cannot silently claim the current one.
  insertPaperRow(db, "pt_unspecified", 1.5);
  assert.equal(paperRow(db, "pt_unspecified")?.pnl_formula_version, 1);
});

test("paperStats keeps the two series apart on a real database", async () => {
  const file = path.join(runtimeDir, "stats-split.db");
  const db = reopen(file);
  insertPaperRow(db, "pt_split_v2_win", 10, 2);
  insertPaperRow(db, "pt_split_v2_loss", -4, 2);
  insertPaperRow(db, "pt_split_legacy", -30, 1);

  const { paperStats } = await import("../src/lib/paper");
  const stats = paperStats("usr_admin");

  assert.equal(stats.comparable.closedCount, 2);
  assert.equal(stats.comparable.realizedTotal, 6, "il totale ufficiale deve sommare solo le chiusure V2");
  assert.equal(stats.comparable.wins, 1);
  assert.equal(stats.comparable.losses, 1);
  assert.equal(stats.legacy.closedCount, 1);
  assert.equal(stats.legacy.realizedTotal, -30);
  assert.equal(stats.closedCount, 3, "il conteggio totale resta disponibile, i totali restano separati");
  assert.equal(stats.openCount, 0);
  assert.equal(stats.unknownResultCount, 0);
});

test("a fresh database stores the P&L formula version with a legacy default", () => {
  const file = path.join(runtimeDir, "fresh-paper.db");
  const db = reopen(file);

  const columns = db.prepare("PRAGMA table_info(paper_trades)").all() as unknown as {
    name: string;
    notnull: number;
    dflt_value: string | null;
  }[];
  const version = columns.find((c) => c.name === "pnl_formula_version");
  assert.ok(version, "la colonna deve esistere anche su un database nuovo");
  assert.equal(version.notnull, 1);
  assert.equal(version.dflt_value, "1");
});
