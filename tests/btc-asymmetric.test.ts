import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateBtcBudget,
  buildBtcTakeProfitTable,
  calculateBtcTakeProfit,
  classifyBtcDailyMove,
  DEFAULT_BTC_STRATEGY,
  validateBtcStrategyConfig,
} from "../src/lib/engine/btc-asymmetric";

test("allocates the 40/40/20 budget without treating BTC inventory as cash", () => {
  assert.deepEqual(allocateBtcBudget(10_000), {
    cashEur: 4_000,
    cryptoInventoryTargetEur: 4_000,
    dcaReserveEur: 2_000,
    totalEur: 10_000,
  });
});

test("classifies the PDF daily move rules", () => {
  assert.equal(classifyBtcDailyMove(-2), "accumulate_twap");
  assert.equal(classifyBtcDailyMove(-4), "accumulate_twap");
  assert.equal(classifyBtcDailyMove(-3), "accumulate_twap");
  assert.equal(classifyBtcDailyMove(-1.99), "wait");
  assert.equal(classifyBtcDailyMove(-4.01), "wait");
  assert.equal(classifyBtcDailyMove(-7.99), "wait");
  assert.equal(classifyBtcDailyMove(-8), "activate_dca_reserve");
  assert.equal(classifyBtcDailyMove(-12), "activate_dca_reserve");
  assert.equal(classifyBtcDailyMove(1), "wait");
});

test("calculates an exact +2% net target after both 0.09% fees", () => {
  const target = calculateBtcTakeProfit(71_475, 2, 0.09, 0.09, 10_000);
  assert.equal(target.sellPriceEur, 73_035.85);
  assert.equal(target.netProfitEur, 200);
  assert.ok(Math.abs(target.multiplier - 1.02183765) < 0.00000001);
});

test("calculates net profit against actual position cost, not the whole wallet", () => {
  const target = calculateBtcTakeProfit(71_475, 3, 0.09, 0.09, 4_000);
  assert.equal(target.netProfitEur, 120);
});

test("builds all five take-profit levels from the average entry", () => {
  const table = buildBtcTakeProfitTable(71_475, 10_000);
  assert.deepEqual(table.map((row) => row.targetNetPct), [2, 3, 4, 5, 8]);
  assert.equal(table[0].sellPriceEur, 73_035.85);
  assert.equal(table[4].netProfitEur, 800);
});

test("rejects inconsistent budget percentages and invalid risk parameters", () => {
  const invalid = { capitalEur: 10_000, ...DEFAULT_BTC_STRATEGY, cashPct: 50 };
  assert.ok(validateBtcStrategyConfig(invalid).some((error) => error.includes("100%")));
});
