import test from "node:test";
import assert from "node:assert/strict";
import {
  walkAsks,
  walkBids,
  evaluateOpportunity,
  bestSize,
  depthWithinSlippage,
  type Book,
  type CostModel,
} from "../src/lib/engine/arbitrage";

const NOW = 1_800_000_000_000;

type RawLevel = [number, number] | number;
const norm = (levels: RawLevel[]): [number, number][] => levels.map((l) => (Array.isArray(l) ? l : [l, 1]));

const book = (venue: string, asks: RawLevel[], bids: RawLevel[], ts = NOW): Book => ({
  venue,
  pair: "BTC/USD",
  asks: norm(asks).map(([price, size]) => ({ price, size })),
  bids: norm(bids).map(([price, size]) => ({ price, size })),
  ts,
});

const COST: CostModel = {
  buyFeePct: 0.8,
  sellFeePct: 0.9,
  transferMode: "prefunded",
  networkFeeInBase: null,
  safetyBufferPct: 0.05,
  maxSlippagePct: 0.6,
  minMarginPct: 0.35,
  maxDataAgeMs: 20_000,
  minNotionalQuote: 10,
};

/* -------------------------------------------------------------------------- */
/* Book walking                                                               */
/* -------------------------------------------------------------------------- */

test("walkAsks computes a depth-weighted VWAP across price levels", () => {
  // capacity: 100 + 2*101 = 302, so a 250 budget is fully filled across both levels
  const r = walkAsks([{ price: 100, size: 1 }, { price: 101, size: 2 }], 250);
  assert.equal(r.complete, true);
  assert.equal(r.filledQuote, 250);
  assert.ok(Math.abs(r.filledBase - (1 + 150 / 101)) < 1e-9);
  assert.ok(Math.abs(r.avgPrice - 250 / (1 + 150 / 101)) < 1e-9);
  assert.ok(r.avgPrice > 100 && r.avgPrice < 101);
});

test("walkAsks reports an incomplete fill when the book is too thin", () => {
  const r = walkAsks([{ price: 90_000, size: 0.001 }], 500);
  assert.equal(r.complete, false);
  assert.equal(r.filledQuote, 90);
});

test("walkBids reports an incomplete fill when size is not available", () => {
  const r = walkBids([{ price: 100, size: 0.5 }], 1);
  assert.equal(r.complete, false);
  assert.ok(Math.abs(r.filledQuote - 50) < 1e-9);
});

test("depthWithinSlippage stops at the tolerated deviation", () => {
  const depth = depthWithinSlippage([{ price: 100, size: 1 }, { price: 100.5, size: 1 }, { price: 103, size: 5 }], 0.6);
  assert.ok(Math.abs(depth - 200.5) < 1e-9);
});

/* -------------------------------------------------------------------------- */
/* The rule that matters: a positive spread is NOT an opportunity              */
/* -------------------------------------------------------------------------- */

test("positive 0.39% spread is rejected: taker fees eat it (NO PROFIT = NO TRADE)", () => {
  const buy = book("kraken", [[90_000, 1]], [89_990]);
  const sell = book("coinbase", [[90_360, 1]], [[90_350, 1]]);
  const e = evaluateOpportunity({ pair: "BTC/USD", buyBook: buy, sellBook: sell, notionalQuote: 500, cost: COST, now: NOW });

  assert.ok(e.grossSpreadPct > 0.38, `gross spread ${e.grossSpreadPct} should look attractive`);
  assert.ok(e.netProfit < 0, `net profit should be negative, got ${e.netProfit}`);
  assert.equal(e.executable, false);
  assert.ok(e.rejectReasons.some((r) => r.includes("NO PROFIT = NO TRADE")));
});

test("1.7% spread above combined fees produces a positive, executable net profit", () => {
  const buy = book("kraken", [[90_000, 1]], [89_990]);
  const sell = book("coinbase", [[92_600, 1]], [[92_500, 1]]);
  const e = evaluateOpportunity({ pair: "BTC/USD", buyBook: buy, sellBook: sell, notionalQuote: 500, cost: COST, now: NOW });

  // buy 500 -> fee 4.00 -> spend 504.00
  assert.ok(Math.abs(e.buySpend - 504) < 1e-6);
  // sell 0.005555..BTC at 92500 = 513.888.. -> fee 0.9% = 4.625
  assert.ok(Math.abs(e.sellFee - 4.625) < 1e-3);
  // buffer 0.05% of after-fee proceeds
  assert.ok(e.bufferCost > 0);
  assert.ok(e.netProfit > 0, `net profit ${e.netProfit}`);
  assert.ok(Math.abs(e.marginPct - (e.netProfit / e.buySpend) * 100) < 1e-6);
  assert.equal(e.executable, true);
  assert.deepEqual(e.rejectReasons, []);
  assert.ok(e.breakevenSpreadPct > 1.7, "breakeven must include both taker fees plus buffer");
});

test("margin below the configured threshold is not executable even when profitable", () => {
  const buy = book("kraken", [[90_000, 1]], [89_990]);
  const sell = book("coinbase", [[92_600, 1]], [[92_500, 1]]);
  const strict = { ...COST, minMarginPct: 5 };
  const e = evaluateOpportunity({ pair: "BTC/USD", buyBook: buy, sellBook: sell, notionalQuote: 500, cost: strict, now: NOW });
  assert.ok(e.netProfit > 0);
  assert.equal(e.executable, false);
  assert.ok(e.rejectReasons.some((r) => r.includes("soglia minima")));
});

test("thin depth blocks the trade instead of pretending to fill", () => {
  const buy = book("kraken", [[90_000, 0.001]], [89_990]);
  const sell = book("coinbase", [[95_000, 1]], [[94_990, 1]]);
  const e = evaluateOpportunity({ pair: "BTC/USD", buyBook: buy, sellBook: sell, notionalQuote: 500, cost: COST, now: NOW });
  assert.equal(e.executable, false);
  assert.ok(e.rejectReasons.some((r) => r.includes("Liquidità insufficiente sul book di acquisto")));
});

test("transfer mode with an unconfigured network fee refuses to produce a signal", () => {
  const buy = book("kraken", [[90_000, 1]], [89_990]);
  const sell = book("coinbase", [[95_000, 1]], [[94_990, 1]]);
  const e = evaluateOpportunity({
    pair: "BTC/USD",
    buyBook: buy,
    sellBook: sell,
    notionalQuote: 500,
    cost: { ...COST, transferMode: "transfer", networkFeeInBase: null },
    now: NOW,
  });
  assert.equal(e.executable, false);
  assert.ok(e.rejectReasons.some((r) => r.includes("trasferimento on-chain non configurato")));
  assert.ok(Number.isNaN(e.netProfit), "net profit must be unknown, never zero");
});

test("transfer mode charges the known network fee and stays profitable", () => {
  const buy = book("kraken", [[90_000, 1]], [89_990]);
  const sell = book("coinbase", [[92_600, 1]], [[92_500, 1]]);
  const e = evaluateOpportunity({
    pair: "BTC/USD",
    buyBook: buy,
    sellBook: sell,
    notionalQuote: 500,
    cost: { ...COST, transferMode: "transfer", networkFeeInBase: 0.00002 },
    now: NOW,
  });
  assert.ok(Math.abs(e.transferCost - 0.00002 * e.sellVwap) < 1e-6);
  // The transferred network fee is removed from the base quantity BEFORE selling.
  const expectedSellable = 500 / 90_000 - 0.00002;
  assert.ok(Math.abs(e.qtyBase - expectedSellable) < 1e-9);
  assert.ok(Math.abs(e.sellProceeds - expectedSellable * 92_500) < 1e-4);
  assert.equal(e.executable, true);
});

test("stale books cannot be executed", () => {
  const buy = book("kraken", [[90_000, 1]], [89_990], NOW - 60_000);
  const sell = book("coinbase", [[92_600, 1]], [[92_500, 1]], NOW - 60_000);
  const e = evaluateOpportunity({ pair: "BTC/USD", buyBook: buy, sellBook: sell, notionalQuote: 500, cost: COST, now: NOW });
  assert.equal(e.executable, false);
  assert.ok(e.rejectReasons.some((r) => r.includes("Dati non aggiornati")));
});

test("one fresh book cannot hide the other stale book", () => {
  const buy = book("kraken", [[90_000, 1]], [89_990], NOW - 60_000);
  const sell = book("bybit", [[92_600, 1]], [[92_500, 1]], NOW - 100);
  const e = evaluateOpportunity({ pair: "BTC/USD", buyBook: buy, sellBook: sell, notionalQuote: 500, cost: COST, now: NOW });
  assert.equal(e.executable, false);
  assert.equal(e.dataAgeMs, 60_000);
  assert.ok(e.rejectReasons.some((r) => r.includes("Dati non aggiornati")));
});

test("network fee larger than the acquired quantity is rejected", () => {
  const buy = book("kraken", [[90_000, 1]], [89_990]);
  const sell = book("coinbase", [[92_600, 1]], [[92_500, 1]]);
  const e = evaluateOpportunity({
    pair: "BTC/USD",
    buyBook: buy,
    sellBook: sell,
    notionalQuote: 500,
    cost: { ...COST, transferMode: "transfer", networkFeeInBase: 1 },
    now: NOW,
  });
  assert.equal(e.executable, false);
  assert.ok(e.rejectReasons.some((r) => r.includes("fee di rete")));
});

/* -------------------------------------------------------------------------- */
/* Size optimisation                                                          */
/* -------------------------------------------------------------------------- */

test("bestSize picks a size the book can actually absorb", () => {
  const buy = book("kraken", [[100, 100]], [99.9]);
  const sell = book("coinbase", [[106, 100]], [[105, 1]]);
  const { best, curve } = bestSize({ pair: "BTC/USD", buyBook: buy, sellBook: sell, cost: COST }, 100);
  assert.ok(curve.length >= 3);
  assert.equal(best.executable, true);
  assert.ok(best.notionalQuote <= 100, `best size ${best.notionalQuote} must fit the bid depth`);
});

test("same-venue pairs are never executable", () => {
  const b = book("kraken", [[90_000, 1]], [89_990]);
  const e = evaluateOpportunity({ pair: "BTC/USD", buyBook: b, sellBook: b, notionalQuote: 500, cost: COST, now: NOW });
  assert.equal(e.executable, false);
  assert.ok(e.rejectReasons.some((r) => r.includes("stessa venue")));
});
