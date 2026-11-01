import test from "node:test";
import assert from "node:assert/strict";
import { calculatePaperRealizedProfit } from "../src/lib/engine/paper";

test("paper exit does not deduct a transfer fee already removed from entry quantity", () => {
  const exitProceeds = 520;
  const sellFeePct = 0.9;
  const safetyBufferPct = 0.05;
  const entrySpend = 504;

  const expected = exitProceeds
    - exitProceeds * (sellFeePct / 100)
    - exitProceeds * (safetyBufferPct / 100)
    - entrySpend;

  const realized = calculatePaperRealizedProfit({
    exitProceeds,
    sellFeePct,
    safetyBufferPct,
    entrySpend,
  });

  assert.ok(Math.abs(realized - expected) < 1e-10);
  // A transfer fee was already reflected in the quantity used to calculate
  // exitProceeds; applying it a second time would understate P&L.
  const wronglyDoubleCharged = realized - 0.000002 * 92_000;
  assert.ok(realized > wronglyDoubleCharged);
});


import { calculatePaperPerformance } from "../src/lib/engine/paper-analytics";

test("paper analytics calculate profit factor and trade averages from net P&L", () => {
  const stats = calculatePaperPerformance([10, -5, 0, 15, -5]);

  assert.equal(stats.wins, 2);
  assert.equal(stats.losses, 2);
  assert.equal(stats.winRate, 40);
  assert.equal(stats.profitFactor, 2.5);
  assert.equal(stats.averageWin, 12.5);
  assert.equal(stats.averageLoss, -5);
  assert.equal(stats.bestTrade, 15);
  assert.equal(stats.worstTrade, -5);
});

test("paper analytics handle no trades and no losing trades without Infinity values", () => {
  const empty = calculatePaperPerformance([]);
  assert.equal(empty.winRate, null);
  assert.equal(empty.profitFactor, null);
  assert.equal(empty.averageWin, null);
  assert.equal(empty.averageLoss, null);
  assert.equal(empty.bestTrade, null);
  assert.equal(empty.worstTrade, null);

  const allWins = calculatePaperPerformance([2, 4]);
  assert.equal(allWins.profitFactor, null);
  assert.equal(allWins.averageWin, 3);
  assert.equal(allWins.averageLoss, null);
});


import { comparePaperExpectedToRealized } from "../src/lib/engine/paper-analytics";

test("paper comparison measures realized result against opening estimates", () => {
  const result = comparePaperExpectedToRealized([
    { expectedProfit: 12, realizedProfit: 9 },
    { expectedProfit: 8, realizedProfit: 10 },
  ]);

  assert.equal(result.expectedTotal, 20);
  assert.equal(result.realizedTotal, 19);
  assert.equal(result.delta, -1);
  assert.equal(result.realizationPct, 95);
});

test("paper comparison ignores non-finite rows and avoids invalid realization ratios", () => {
  const result = comparePaperExpectedToRealized([
    { expectedProfit: 0, realizedProfit: 3 },
    { expectedProfit: Number.NaN, realizedProfit: 4 },
  ]);

  assert.equal(result.expectedTotal, 0);
  assert.equal(result.realizedTotal, 3);
  assert.equal(result.delta, 3);
  assert.equal(result.realizationPct, null);
});
