import { ARBITRAGE_VENUES, type EngineSettings, type Quote } from "./config";
import { newId } from "./crypto";
import { all, getUserSettings, one, run } from "./db";
import { bestSize, evaluateOpportunity, type Book, type CostModel, type Evaluation } from "./engine/arbitrage";
import { resolveFee } from "./engine/fees";
import { getNetworkFees } from "./network-fees";
import { ADAPTERS } from "./venues";
import type { Ticker } from "./venues/types";

/* -------------------------------------------------------------------------- */
/* Small TTL cache shared across requests (globalThis survives HMR)            */
/* -------------------------------------------------------------------------- */

type Cached<T> = { ts: number; data: T };
const g = globalThis as unknown as { __gmCache?: Map<string, Cached<unknown>> };
const cache = g.__gmCache ?? new Map<string, Cached<unknown>>();
g.__gmCache = cache;

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Cached<T> | undefined;
  if (hit && Date.now() - hit.ts < ttlMs) return hit.data;
  const data = await fn();
  cache.set(key, { ts: Date.now(), data });
  return data;
}

export const clearMarketCache = () => cache.clear();

/* -------------------------------------------------------------------------- */
/* Pair discovery                                                              */
/* -------------------------------------------------------------------------- */

export type UniverseEntry = { pair: string; venues: string[] };

export async function pairUniverse(quote: Quote): Promise<UniverseEntry[]> {
  return cached(`universe:${quote}`, 30 * 60 * 1000, async () => {
    const perVenue = await Promise.all(
      ARBITRAGE_VENUES.map(async (id) => {
        try {
          return { id, pairs: await ADAPTERS[id].discoverPairs() };
        } catch {
          return { id, pairs: [] as string[] };
        }
      }),
    );
    const byPair = new Map<string, string[]>();
    for (const { id, pairs } of perVenue) {
      for (const pair of pairs) {
        if (!pair.endsWith(`/${quote}`)) continue;
        const list = byPair.get(pair) ?? [];
        if (!list.includes(id)) list.push(id);
        byPair.set(pair, list);
      }
    }
    return [...byPair.entries()]
      .filter(([, venues]) => venues.length >= 2) // a cross-venue trade needs two venues
      .map(([pair, venues]) => ({ pair, venues }))
      .sort((a, b) => a.pair.localeCompare(b.pair));
  });
}

/* -------------------------------------------------------------------------- */
/* Live board                                                                  */
/* -------------------------------------------------------------------------- */

export type BoardVenue = { venue: string; bid: number; ask: number; last: number; ts: number };
export type BoardRow = {
  pair: string;
  venues: BoardVenue[];
  bestBuy: { venue: string; ask: number } | null;
  bestSell: { venue: string; bid: number } | null;
  grossSpreadPct: number;
};

export type Board = { quote: Quote; ts: number; rows: BoardRow[]; errors: string[] };

const MAX_PAIRS = 10;

export async function getBoard(quote: Quote): Promise<Board> {
  return cached(`board:${quote}`, 4000, async () => {
    const universe = (await pairUniverse(quote)).slice(0, MAX_PAIRS);
    const pairs = universe.map((u) => u.pair);
    const errors: string[] = [];

    const results = await Promise.allSettled(
      ARBITRAGE_VENUES.map(async (id) => ({ id, tickers: await ADAPTERS[id].tickers(pairs) })),
    );

    const tickersByVenue = new Map<string, Map<string, Ticker>>();
    for (const r of results) {
      if (r.status === "fulfilled") {
        tickersByVenue.set(r.value.id, r.value.tickers);
      } else {
        errors.push(`${(r.reason as Error)?.message ?? "errore venue"}`);
      }
    }

    const rows: BoardRow[] = [];
    for (const { pair } of universe) {
      const venues: BoardVenue[] = [];
      for (const [venue, tickers] of tickersByVenue) {
        const t = tickers.get(pair);
        if (t) venues.push({ venue, bid: t.bid, ask: t.ask, last: t.last, ts: t.ts });
      }
      if (venues.length < 2) continue;
      const bestBuy = venues.reduce((a, b) => (b.ask < a.ask ? b : a));
      const bestSell = venues.reduce((a, b) => (b.bid > a.bid ? b : a));
      rows.push({
        pair,
        venues,
        bestBuy: { venue: bestBuy.venue, ask: bestBuy.ask },
        bestSell: { venue: bestSell.venue, bid: bestSell.bid },
        grossSpreadPct: bestBuy.ask > 0 ? ((bestSell.bid - bestBuy.ask) / bestBuy.ask) * 100 : 0,
      });
    }
    rows.sort((a, b) => b.grossSpreadPct - a.grossSpreadPct);
    return { quote, ts: Date.now(), rows, errors };
  });
}

export async function getBook(venue: string, pair: string): Promise<Book> {
  const adapter = ADAPTERS[venue];
  if (!adapter) throw new Error(`Venue non supportata: ${venue}`);
  return cached(`book:${venue}:${pair}`, 2500, () => adapter.book(pair, 25));
}

/* -------------------------------------------------------------------------- */
/* Cost model                                                                  */
/* -------------------------------------------------------------------------- */

export function buildCostModel(
  settings: EngineSettings,
  buyFeePct: number,
  sellFeePct: number,
  baseAsset: string,
): CostModel {
  const network = getNetworkFees()[baseAsset];
  return {
    buyFeePct,
    sellFeePct,
    transferMode: settings.transferMode,
    networkFeeInBase: network?.feeInBase ?? null,
    safetyBufferPct: settings.safetyBufferPct,
    maxSlippagePct: settings.maxSlippagePct,
    minMarginPct: settings.minMarginPct,
    maxDataAgeMs: settings.maxDataAgeMs,
    minNotionalQuote: 10,
  };
}

/* -------------------------------------------------------------------------- */
/* Scan                                                                        */
/* -------------------------------------------------------------------------- */

export type ScanEvaluation = Evaluation & {
  baseAsset: string;
  buyFeePct: number;
  sellFeePct: number;
  buyFeeSource: string;
  sellFeeSource: string;
  optimalNotional: number;
  optimalMarginPct: number;
  optimalNetProfit: number;
  curve: { notional: number; net: number; marginPct: number; executable: boolean }[];
};

export type ScanSummary = {
  id: string;
  ts: string;
  durationMs: number;
  quote: Quote;
  pairsScanned: number;
  candidates: number;
  executable: number;
  bestMarginPct: number | null;
  errors: string[];
  evaluations: ScanEvaluation[];
};

const round = (v: number, d = 8) => (Number.isFinite(v) ? Number(v.toFixed(d)) : v);

export async function runScan(
  userId: string | null,
  opts: { limitCandidates?: number } = {},
): Promise<ScanSummary> {
  const started = Date.now();
  const settings = getUserSettings(userId);
  const quote = settings.quote;
  const limit = opts.limitCandidates ?? 5;
  const errors: string[] = [];

  const board = await getBoard(quote);
  errors.push(...board.errors);

  // Ordered venue pairs, ranked by raw top-of-book spread.
  const directions: { pair: string; buy: string; sell: string; gross: number }[] = [];
  for (const row of board.rows) {
    for (const buy of row.venues) {
      for (const sell of row.venues) {
        if (buy.venue === sell.venue) continue;
        directions.push({
          pair: row.pair,
          buy: buy.venue,
          sell: sell.venue,
          gross: buy.ask > 0 ? ((sell.bid - buy.ask) / buy.ask) * 100 : -Infinity,
        });
      }
    }
  }
  directions.sort((a, b) => b.gross - a.gross);
  const targets = directions.slice(0, limit);

  const evaluations: ScanEvaluation[] = [];

  for (const target of targets) {
    const baseAsset = target.pair.split("/")[0];
    const buyFee = resolveFee(target.buy, userId);
    const sellFee = resolveFee(target.sell, userId);
    if (!buyFee || !sellFee) {
      errors.push(`Commissioni non configurate per ${target.buy} o ${target.sell}: segnale scartato.`);
      continue;
    }
    try {
      const [buyBook, sellBook] = await Promise.all([getBook(target.buy, target.pair), getBook(target.sell, target.pair)]);
      const cost = buildCostModel(settings, buyFee.takerPct, sellFee.takerPct, baseAsset);
      const evaluation = evaluateOpportunity({
        pair: target.pair,
        buyBook,
        sellBook,
        notionalQuote: settings.notionalQuote,
        cost,
      });
      const sized = bestSize({ pair: target.pair, buyBook, sellBook, cost }, settings.notionalQuote);
      evaluations.push({
        ...evaluation,
        baseAsset,
        buyFeePct: buyFee.takerPct,
        sellFeePct: sellFee.takerPct,
        buyFeeSource: buyFee.source,
        sellFeeSource: sellFee.source,
        optimalNotional: sized.best.notionalQuote,
        optimalMarginPct: sized.best.marginPct,
        optimalNetProfit: sized.best.netProfit,
        curve: sized.curve.map((c) => ({
          notional: c.notionalQuote,
          net: round(c.netProfit),
          marginPct: round(c.marginPct, 6),
          executable: c.executable,
        })),
      });
    } catch (err) {
      errors.push(`${target.pair} ${target.buy}→${target.sell}: ${(err as Error).message}`);
    }
  }

  const executable = evaluations.filter((e) => e.executable).length;
  const bestMarginPct = evaluations.length
    ? Math.max(...evaluations.map((e) => (Number.isFinite(e.marginPct) ? e.marginPct : -Infinity)))
    : null;

  const id = newId("scan");
  const ts = new Date().toISOString();
  const durationMs = Date.now() - started;

  // Persist the scan (best effort: the API still answers if the write fails).
  try {
    for (const e of evaluations) {
      run(
        `INSERT INTO opportunities(id, user_id, ts, pair, buy_venue, sell_venue, notional, buy_vwap, sell_vwap,
          top_buy, top_sell, gross_spread_pct, fee_buy, fee_sell, transfer_cost, slippage_pct, buffer_cost,
          net_profit, margin_pct, executable, reject_reason, data_age_ms, payload)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId("opp"),
        null, // market-wide observation, shared by every tenant
        ts,
        e.pair,
        e.buyVenue,
        e.sellVenue,
        e.notionalQuote,
        e.buyVwap,
        e.sellVwap,
        e.topAsk,
        e.topBid,
        e.grossSpreadPct,
        round(e.buyFee),
        round(e.sellFee),
        Number.isFinite(e.transferCost) ? round(e.transferCost) : 0,
        e.buySlippagePct + e.sellSlippagePct,
        round(e.bufferCost),
        Number.isFinite(e.netProfit) ? round(e.netProfit) : 0,
        Number.isFinite(e.marginPct) ? round(e.marginPct, 6) : 0,
        e.executable ? 1 : 0,
        e.rejectReasons.join(" | ").slice(0, 900) || null,
        e.dataAgeMs,
        JSON.stringify({
          qtyBase: e.qtyBase,
          buySpend: e.buySpend,
          sellProceeds: e.sellProceeds,
          breakevenSpreadPct: e.breakevenSpreadPct,
          buyDepthQuote: e.buyDepthQuote,
          sellDepthQuote: e.sellDepthQuote,
          fees: { buy: e.buyFeePct, sell: e.sellFeePct, buySource: e.buyFeeSource, sellSource: e.sellFeeSource },
          optimal: { notional: e.optimalNotional, marginPct: e.optimalMarginPct, net: e.optimalNetProfit },
          curve: e.curve,
          quote: settings.quote,
        }).slice(0, 4000),
      );
    }
    run(
      `INSERT INTO scan_runs(id, ts, venues, pairs, candidates, executable, best_margin, errors, duration_ms)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      id,
      ts,
      JSON.stringify(ARBITRAGE_VENUES),
      board.rows.length,
      evaluations.length,
      executable,
      bestMarginPct === null || !Number.isFinite(bestMarginPct) ? null : round(bestMarginPct, 6),
      errors.join(" | ").slice(0, 900) || null,
      durationMs,
    );
  } catch (err) {
    errors.push(`Persistenza non riuscita: ${(err as Error).message}`);
  }

  return {
    id,
    ts,
    durationMs,
    quote,
    pairsScanned: board.rows.length,
    candidates: evaluations.length,
    executable,
    bestMarginPct: bestMarginPct !== null && Number.isFinite(bestMarginPct) ? bestMarginPct : null,
    errors,
    evaluations,
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export type OpportunityRow = {
  id: string;
  ts: string;
  pair: string;
  buy_venue: string;
  sell_venue: string;
  notional: number;
  buy_vwap: number;
  sell_vwap: number;
  top_buy: number;
  top_sell: number;
  gross_spread_pct: number;
  fee_buy: number;
  fee_sell: number;
  transfer_cost: number;
  slippage_pct: number;
  buffer_cost: number;
  net_profit: number;
  margin_pct: number;
  executable: number;
  reject_reason: string | null;
  data_age_ms: number;
  payload: string;
};

export type ScanRunRow = {
  id: string;
  ts: string;
  venues: string;
  pairs: number;
  candidates: number;
  executable: number;
  best_margin: number | null;
  errors: string | null;
  duration_ms: number;
};

export function latestScan(): ScanRunRow | null {
  return one<ScanRunRow>("SELECT * FROM scan_runs ORDER BY ts DESC LIMIT 1");
}

export function recentScans(limit = 20): ScanRunRow[] {
  return all<ScanRunRow>("SELECT * FROM scan_runs ORDER BY ts DESC LIMIT ?", limit);
}

export function latestOpportunities(scanTs?: string, limit = 40): OpportunityRow[] {
  if (scanTs) {
    return all<OpportunityRow>(
      "SELECT * FROM opportunities WHERE ts = ? ORDER BY executable DESC, margin_pct DESC LIMIT ?",
      scanTs,
      limit,
    );
  }
  return all<OpportunityRow>("SELECT * FROM opportunities ORDER BY ts DESC, margin_pct DESC LIMIT ?", limit);
}

export function opportunityById(id: string): OpportunityRow | null {
  return one<OpportunityRow>("SELECT * FROM opportunities WHERE id = ?", id);
}

export function opportunityHistory(hours = 24, limit = 200): OpportunityRow[] {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  return all<OpportunityRow>(
    "SELECT * FROM opportunities WHERE ts >= ? ORDER BY ts DESC LIMIT ?",
    since,
    limit,
  );
}

/** Best net margin per scan, for the dashboard sparkline. */
export function marginSeries(limit = 40): { ts: string; best: number; executable: number }[] {
  return all<{ ts: string; best: number; executable: number }>(
    `SELECT ts, MAX(margin_pct) AS best, MAX(executable) AS executable
     FROM opportunities GROUP BY ts ORDER BY ts DESC LIMIT ?`,
    limit,
  ).reverse();
}

export function parsePayload(row: OpportunityRow): Record<string, unknown> {
  try {
    return JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}
