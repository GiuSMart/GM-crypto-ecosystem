import test from "node:test";
import assert from "node:assert/strict";
import { simulateFundingCarry, type FundingCarrySimulationInput } from "../src/lib/engine/funding-sim";

// Quote amounts are produced by percentage arithmetic, so compare with tolerance.
const close = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

const input: FundingCarrySimulationInput = {
  spotNotionalQuote: 10_000,
  perpNotionalQuote: 10_000,
  entryBasisPct: 0.05,
  exitBasisPct: 0.05,
  fundingRates: [0.0001, 0.0001, 0.0001],
  intervalsPerDay: 3,
  feePctPerLeg: 0.05,
  slippagePctPerLeg: 0.02,
  legsPerSide: 2,
  leverage: 3,
  maintenanceMarginPct: 0.5,
};

const run = (overrides: Partial<FundingCarrySimulationInput> = {}) =>
  simulateFundingCarry({ ...input, ...overrides });

test("one day of 0.01% funding on 10,000 quote collects 3 quote", () => {
  // This is the figure from the operator's scenario, reproduced by the model rather
  // than quoted: 0.0001 * 10,000 * 3 intervals.
  const result = run();
  assert.equal(result.ok, true, result.reasons.join(" "));
  assert.equal(result.totalFundingQuote, 3);
  assert.equal(result.days, 1);
  assert.equal(result.periods.length, 3);
  assert.equal(result.periods[2].cumulativeFundingQuote, 3);
});

test("the round trip is charged on both legs, twice", () => {
  const result = run();
  const expected = 2 * 2 * ((0.05 + 0.02) / 100) * 10_000;
  assert.ok(Math.abs(result.costsQuote - expected) < 1e-9);
  close(result.costsQuote, 28);
  close(result.netPnlQuote, 3 - 28);
});

test("required capital includes the perpetual margin, so returns are not overstated", () => {
  const result = run();
  assert.ok(Math.abs(result.capitalRequiredQuote - (10_000 + 10_000 / 3)) < 1e-9);
  assert.ok(Math.abs(result.netReturnPct - ((3 - 28) / result.capitalRequiredQuote) * 100) < 1e-9);
  assert.ok(result.netReturnPct > -0.2 && result.netReturnPct < 0);
});

test("a basis that converges to zero pays the short leg", () => {
  const converged = run({ entryBasisPct: 0.5, exitBasisPct: 0 });
  close(converged.basisPnlQuote, 50);
  close(converged.netPnlQuote, 3 + 50 - 28);
  assert.equal(converged.ok, true);
});

test("a basis that widens costs the short leg", () => {
  const widened = run({ entryBasisPct: 0.1, exitBasisPct: 0.6 });
  close(widened.basisPnlQuote, -50);
  close(widened.netPnlQuote, 3 - 50 - 28);
});

test("negative funding drains the position period by period", () => {
  const result = run({ fundingRates: [-0.0001, -0.0001, -0.0001] });
  assert.equal(result.totalFundingQuote, -3);
  assert.equal(result.periods[0].fundingPnlQuote, -1);
});

test("the liquidation buffer is the margin buffer on the perpetual leg", () => {
  const result = run();
  assert.ok(Math.abs(result.liquidationBufferQuote - (1 / 3 - 0.005) * 10_000) < 1e-9);
  assert.equal(result.liquidated, false);
});

test("a loss larger than the margin buffer marks the position liquidated", () => {
  const result = run({ fundingRates: [-0.5, -0.5, -0.5] });
  assert.equal(result.liquidated, true);
});

test("max drawdown includes the entry costs, not just the funding swings", () => {
  const result = run();
  // Equity starts from zero, so the trough after the first period is the cost minus
  // the first funding payment: the drawdown is 27, not the full 28 quote charged.
  close(result.maxDrawdownQuote, 27);
  close(result.worstPeriodQuote, 1 - 28);
});

test("an empty funding series is refused instead of reporting zero", () => {
  const result = run({ fundingRates: [] });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes("Serie di funding vuota")));
});

test("a non-finite rate is refused", () => {
  const result = run({ fundingRates: [0.0001, Number.NaN] });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes("non finiti")));
});

test("an empty leg or zero leverage is refused", () => {
  assert.equal(run({ spotNotionalQuote: 0 }).ok, false);
  assert.equal(run({ perpNotionalQuote: -1 }).ok, false);
  assert.equal(run({ leverage: 0 }).ok, false);
});

test("the simulation is deterministic: the same inputs produce the same curve", () => {
  const first = run({ fundingRates: [0.0001, -0.00005, 0.0002] });
  const second = run({ fundingRates: [0.0001, -0.00005, 0.0002] });
  assert.deepEqual(first, second);
});
