import test from "node:test";
import assert from "node:assert/strict";
import { evaluateOpportunity, type Book, type CostModel } from "../src/lib/engine/arbitrage";
import { NETWORK_FEES, REFERENCE_FEES } from "../src/lib/config";

/**
 * Regression tests for the money path.
 *
 * Every expected number below is computed by hand from the formulas documented in
 * src/lib/engine/arbitrage.ts, then pinned here. If a future change alters fees,
 * transfer accounting or the break-even definition, these assertions fail.
 */

const NOW = 1_800_000_000_000;

const book = (venue: string, asks: [number, number][], bids: [number, number][], ts = NOW): Book => ({
  venue,
  pair: "BTC/USD",
  asks: asks.map(([price, size]) => ({ price, size })),
  bids: bids.map(([price, size]) => ({ price, size })),
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

// 250 USD buys across two ask levels: 1 BTC @100 + 150 USD @101 = 2.48514851 BTC.
const BUY = book("kraken", [[100, 1], [101, 2]], [[99.9, 5]]);
// The same 2.48514851 BTC sells 1 @110 and 1.48514851 @109.
const SELL = book("coinbase", [[109.5, 10]], [[110, 1], [109, 5]]);

test("regression: prefunded net profit equals the hand-computed cost stack", () => {
  const e = evaluateOpportunity({ pair: "BTC/USD", buyBook: BUY, sellBook: SELL, notionalQuote: 250, cost: COST, now: NOW });

  // Buy leg: VWAP 100.5976095617, taker fee 0.8% of 250 = 2.00, total debited 252.00.
  assert.ok(Math.abs(e.buyVwap - 100.5976095618) < 1e-9, `buy VWAP ${e.buyVwap}`);
  assert.equal(e.buyFee, 2);
  assert.ok(Math.abs(e.buySpend - 252) < 1e-9);

  // Sell leg: 271.8811881188 gross, taker fee 0.9% = 2.4469306931, buffer 0.05% = 0.1347171287.
  assert.ok(Math.abs(e.sellProceeds - 271.8811881188) < 1e-8, `proceeds ${e.sellProceeds}`);
  assert.ok(Math.abs(e.sellFee - 2.4469306931) < 1e-9, `sell fee ${e.sellFee}`);
  assert.ok(Math.abs(e.bufferCost - 0.1347171287) < 1e-9, `buffer ${e.bufferCost}`);

  // net = 271.8811881188 - 2.4469306931 - 0.1347171287 - 252 = 17.2995402970
  assert.ok(Math.abs(e.netProfit - 17.299540297) < 1e-8, `net ${e.netProfit}`);
  assert.equal(e.marginPct, 6.864897);
  assert.equal(e.executable, true);
  assert.deepEqual(e.rejectReasons, []);
});

test("regression: each taker fee is a percentage of that leg's own quote notional", () => {
  const e = evaluateOpportunity({ pair: "BTC/USD", buyBook: BUY, sellBook: SELL, notionalQuote: 250, cost: COST, now: NOW });

  assert.ok(Math.abs(e.buyFee - 250 * (COST.buyFeePct / 100)) < 1e-9);
  assert.ok(Math.abs(e.sellFee - e.sellProceeds * (COST.sellFeePct / 100)) < 1e-9);
  // The safety buffer is applied to after-fee proceeds, never to the spent amount.
  assert.ok(Math.abs(e.bufferCost - (e.sellProceeds - e.sellFee) * (COST.safetyBufferPct / 100)) < 1e-9);
});

test("regression: transfer mode removes the withdrawal fee from the sold quantity exactly once", () => {
  const cost: CostModel = { ...COST, transferMode: "transfer", networkFeeInBase: 0.01 };
  const e = evaluateOpportunity({ pair: "BTC/USD", buyBook: BUY, sellBook: SELL, notionalQuote: 250, cost, now: NOW });

  // 2.4851485149 acquired - 0.01 withdrawn as network fee = 2.4751485149 sold.
  assert.ok(Math.abs(e.qtyBase - 2.4751485149) < 1e-9, `qty ${e.qtyBase}`);
  assert.ok(Math.abs(e.sellProceeds - 270.7911881188) < 1e-8, `proceeds ${e.sellProceeds}`);
  // The fee is priced at the sale VWAP: 0.01 * 109.4040161606 = 1.0940401616.
  assert.ok(Math.abs(e.transferCost - 1.0940401616) < 1e-9, `transfer ${e.transferCost}`);
  // net = 270.7911881188 * 0.991 * 0.9995 - 252 = 16.2198903920
  assert.ok(Math.abs(e.netProfit - 16.219890392) < 1e-8, `net ${e.netProfit}`);

  // Charging the same withdrawal fee twice would lose another 1.094 and understate P&L.
  assert.ok(e.netProfit - e.transferCost < e.netProfit - 1);
  assert.equal(e.executable, true);
});

test("regression: break-even is the spread where net profit is exactly zero", () => {
  const buy = book("kraken", [[90_000, 1]], [[89_999, 5]]);
  const sell = book("coinbase", [[91_000, 5]], [[90_000, 5]]);
  const flat = evaluateOpportunity({ pair: "BTC/USD", buyBook: buy, sellBook: sell, notionalQuote: 500, cost: COST, now: NOW });

  // Additive estimate (0.8 + 0.9 + 0.05 = 1.75%) ignores the multiplicative fees.
  assert.ok(flat.breakevenSpreadPct > 1.75);
  assert.ok(Math.abs(flat.breakevenSpreadPct - 1.766322) < 1e-6, `break-even ${flat.breakevenSpreadPct}`);

  // Evaluate at exactly that spread: net profit must be zero, not merely positive.
  const price = 90_000 * (1 + flat.breakevenSpreadPct / 100);
  const atBreakeven = evaluateOpportunity({
    pair: "BTC/USD",
    buyBook: buy,
    sellBook: book("coinbase", [[91_000, 5]], [[price, 5]]),
    notionalQuote: 500,
    cost: COST,
    now: NOW,
  });
  assert.ok(Math.abs(atBreakeven.netProfit) < 1e-4, `net at break-even ${atBreakeven.netProfit}`);

  // Depth matters: buying through the second level costs 0.6% more, so the spread
  // needed to break even must be higher than the flat-book value.
  const withDepth = evaluateOpportunity({ pair: "BTC/USD", buyBook: BUY, sellBook: SELL, notionalQuote: 250, cost: COST, now: NOW });
  assert.ok(Math.abs(withDepth.breakevenSpreadPct - 2.374487) < 1e-6, `break-even ${withDepth.breakevenSpreadPct}`);
  assert.ok(withDepth.breakevenSpreadPct > flat.breakevenSpreadPct);
});

test("regression: transfer mode raises break-even because less inventory reaches the sale", () => {
  const prefunded = evaluateOpportunity({ pair: "BTC/USD", buyBook: BUY, sellBook: SELL, notionalQuote: 250, cost: COST, now: NOW });
  const transfer = evaluateOpportunity({
    pair: "BTC/USD",
    buyBook: BUY,
    sellBook: SELL,
    notionalQuote: 250,
    cost: { ...COST, transferMode: "transfer", networkFeeInBase: 0.01 },
    now: NOW,
  });

  assert.ok(Math.abs(transfer.breakevenSpreadPct - 2.788097) < 1e-6, `break-even ${transfer.breakevenSpreadPct}`);
  assert.ok(transfer.breakevenSpreadPct > prefunded.breakevenSpreadPct);
});

test("regression: an unknown transfer cost yields no net profit and no break-even", () => {
  const e = evaluateOpportunity({
    pair: "BTC/USD",
    buyBook: BUY,
    sellBook: SELL,
    notionalQuote: 250,
    cost: { ...COST, transferMode: "transfer", networkFeeInBase: null },
    now: NOW,
  });

  assert.ok(Number.isNaN(e.netProfit));
  assert.ok(Number.isNaN(e.transferCost));
  assert.ok(Number.isNaN(e.breakevenSpreadPct), `break-even ${e.breakevenSpreadPct}`);
  assert.equal(e.executable, false);
});

test("regression: the app ships no invented exchange fee and no invented network fee", () => {
  assert.equal(REFERENCE_FEES.kraken.confidence, "verified");
  assert.equal(REFERENCE_FEES.coinbase.confidence, "unverified");
  // Bybit and OKX have no confirmed schedule: they must stay absent, never guessed.
  assert.equal(REFERENCE_FEES.bybit, undefined);
  assert.equal(REFERENCE_FEES.okx, undefined);
  for (const asset of Object.keys(NETWORK_FEES)) {
    assert.equal(NETWORK_FEES[asset].feeInAsset, null, `${asset}: network fee must stay unconfigured`);
  }
});
