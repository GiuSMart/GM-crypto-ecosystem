import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* -------------------------------------------------------------------------- */
/* Test runtime                                                                */
/* -------------------------------------------------------------------------- */

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-paper-state-"));
process.env.GM_DATA_DIR = runtimeDir;
process.env.GM_DB_PATH = path.join(runtimeDir, "paper.db");
process.env.GM_ADMIN_PASSWORD = "Admin-Paper-Test-a1!";
process.env.GM_DEMO_PASSWORD = "Demo-Paper-Test-a1!";

const USER = "usr_demo";
const PAIR = "BTC/EUR";
const BUY_VENUE = "kraken";
const SELL_VENUE = "coinbase";

type PriceLevel = { price: number; size: number };
type FakeBook = { venue: string; pair: string; ts: number; asks: PriceLevel[]; bids: PriceLevel[] };

/**
 * The paper module only needs two market facts: which opportunity to open and
 * what the books look like. Both are injected here so the state transitions run
 * against the real SQLite schema without touching an exchange.
 */
const levels = (rows: [number, number][]): PriceLevel[] => rows.map(([price, size]) => ({ price, size }));

const book = (venue: string, asks: [number, number][], bids: [number, number][]): FakeBook => ({
  venue,
  pair: PAIR,
  ts: Date.now(),
  asks: levels(asks),
  bids: levels(bids),
});

const MOCKED_MARKET = {
  opportunityById: (id: string) =>
    id === "opp_test"
      ? { id, pair: PAIR, buy_venue: BUY_VENUE, sell_venue: SELL_VENUE, notional: 500 }
      : null,
  getBook: async (venue: string, pair: string): Promise<FakeBook> => {
    assert.equal(pair, PAIR);
    if (venue === BUY_VENUE) return book(venue, [[70_000, 1]], [[69_900, 1]]);
    if (venue === SELL_VENUE) return book(venue, [[72_100, 1]], [[72_000, 1]]);
    throw new Error(`unexpected venue ${venue}`);
  },
};

let paper: typeof import("../src/lib/paper");
let getDb: () => import("node:sqlite").DatabaseSync;
let setFeeOverride: (venueId: string, makerPct: number, takerPct: number, note: string, userId: string | null) => void;
let getDbRow: (id: string) => { pnl_formula_version: number; realized_profit: number | null; status: string; qty: number } | undefined;

test.before(async () => {
  const realMarket = await import("../src/lib/market");
  // Real cost model and book walking; only the two I/O edges are replaced.
  const mocked = { ...realMarket, ...MOCKED_MARKET, buildCostModel: realMarket.buildCostModel };
  // `exports` replaced namedExports from Node 25.9; CI still runs Node 22.
  const NODE_MAJOR = Number(process.versions.node.split(".")[0]);
  mock.module("../src/lib/market", NODE_MAJOR >= 26 ? { exports: mocked } : { namedExports: mocked });

  paper = await import("../src/lib/paper");
  ({ getDb, setFeeOverride } = await import("../src/lib/db"));

  // Coinbase's reference schedule is unverified, so the engine refuses it until
  // the operator confirms the numbers. Confirm them for this test only.
  setFeeOverride(SELL_VENUE, 0.5, 0.9, "override di test", null);

  const db = getDb();
  getDbRow = (id: string) =>
    db
      .prepare("SELECT pnl_formula_version, realized_profit, status, qty FROM paper_trades WHERE id = ?")
      .get(id) as { pnl_formula_version: number; realized_profit: number | null; status: string; qty: number } | undefined;
});

test.after(() => {
  try {
    getDb().close();
  } catch {
    // already closed
  }
  fs.rmSync(runtimeDir, { recursive: true, force: true });
});

/** A position opened and left open by the previous formula. */
function insertLegacyOpenTrade(db: import("node:sqlite").DatabaseSync, id: string) {
  db.prepare(
    `INSERT INTO paper_trades(id, user_id, opportunity_id, pair, buy_venue, sell_venue, notional, qty, buy_vwap, sell_vwap,
       fee_buy, fee_sell, other_costs, expected_profit, expected_margin_pct, status, opened_at, pnl_formula_version, note)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?)`,
  ).run(
    id, USER, "opp_test", PAIR, BUY_VENUE, SELL_VENUE, 500, 0.007, 70_000, 72_000,
    4, 4.536, 0.252, 5, 1, "2026-01-01T10:00:00.000Z", 1, "legacy open",
  );
}

/* -------------------------------------------------------------------------- */

test("a new paper trade is stamped with the current formula", async () => {
  const result = await paper.openPaperTrade(USER, "opp_test");
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  if (!result.ok) return;

  const row = getDbRow(result.id);
  assert.equal(row?.status, "open");
  assert.equal(row?.pnl_formula_version, 2, "una nuova apertura appartiene alla serie ufficiale");
  assert.ok((row?.qty ?? 0) > 0);
});

test("an open legacy position joins the official series only when closed", async () => {
  const db = getDb();
  insertLegacyOpenTrade(db, "pt_legacy_open");

  const before = paper.paperStats(USER);
  const openLegacy = db
    .prepare("SELECT pnl_formula_version FROM paper_trades WHERE id = 'pt_legacy_open'")
    .get() as { pnl_formula_version: number };
  assert.equal(openLegacy.pnl_formula_version, 1, "la riga aperta conserva la formula con cui è nata");
  assert.equal(before.legacy.closedCount, 0, "una posizione aperta non entra in nessuna serie chiusa");

  const closed = await paper.closePaperTrade(USER, "pt_legacy_open");
  assert.equal(closed.ok, true, closed.ok ? "" : closed.error);
  if (!closed.ok) return;

  const row = getDbRow("pt_legacy_open");
  assert.equal(row?.status, "closed");
  assert.equal(row?.pnl_formula_version, 2, "la chiusura con il calcolo corrente promuove la posizione");

  // The exit result must be the current formula, computed by hand here:
  // proceeds on the live bid, minus the taker sell fee and the buffer, minus
  // what the position cost to open. The transfer fee is in neither term.
  const qty = row?.qty ?? 0;
  const proceeds = qty * 72_000;
  const expected = proceeds - proceeds * 0.009 - proceeds * 0.0005 - (500 + 4);
  assert.ok(Math.abs((row?.realized_profit ?? Number.NaN) - expected) < 1e-6, `realizzato ${row?.realized_profit} ≠ ${expected}`);

  const after = paper.paperStats(USER);
  assert.equal(after.comparable.closedCount, 1, "la posizione promossa entra nella serie ufficiale");
  assert.equal(after.legacy.closedCount, 0);
  assert.ok(Math.abs(after.comparable.realizedTotal - expected) < 1e-6);
});

test("closed trades of different formulas stay in separate totals", async () => {
  const db = getDb();
  // A row closed by the previous formula: stored, never recomputed.
  db.prepare("UPDATE paper_trades SET pnl_formula_version = 1, realized_profit = -30 WHERE id = 'pt_legacy_open'").run();

  const stats = paper.paperStats(USER);
  assert.equal(stats.legacy.closedCount, 1);
  assert.equal(stats.legacy.realizedTotal, -30, "il valore storico non viene ricalcolato");
  assert.equal(stats.closedCount, 1, "il conteggio totale segue la riga, non il gruppo");
  assert.equal(stats.comparable.closedCount, 0);
  assert.equal(stats.comparable.realizedTotal, 0, "nessuna chiusura V2 resta: il totale ufficiale torna a zero, non a -30");
});
