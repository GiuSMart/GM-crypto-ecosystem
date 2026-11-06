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

test("costs are attributed to each leg on its own notional, not on an average", () => {
  const equal = run();
  close(equal.spotCostsQuote, 14);
  close(equal.perpCostsQuote, 14);
  close(equal.spotCostsQuote + equal.perpCostsQuote, equal.costsQuote);

  // A hedge whose legs are not equal is charged per leg: the small perpetual leg pays
  // less than the spot leg, and the total is the sum of the two, not an averaged bill.
  const unequal = run({ perpNotionalQuote: 6_000 });
  close(unequal.spotCostsQuote, 2 * 1 * 0.0007 * 10_000);
  close(unequal.perpCostsQuote, 2 * 1 * 0.0007 * 6_000);
  close(unequal.costsQuote, 14 + 8.4);
  close(unequal.capitalRequiredQuote, 10_000 + 6_000 / 3);
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
  assert.equal(result.liquidationIndex, null);
  assert.equal(result.periods.length, 3);
});

test("liquidated runs stop at the liquidation period and are never reported as ok", () => {
  // Equity is charged from the first interval: a -50% funding rate wipes the margin
  // buffer of a 3x position immediately, so periods 2 and 3 must not exist.
  const result = run({ fundingRates: [-0.5, -0.5, -0.5] });
  assert.equal(result.liquidated, true);
  assert.equal(result.ok, false);
  assert.equal(result.liquidationIndex, 0);
  assert.equal(result.liquidationDay, 1 / 3);
  assert.equal(result.periods.length, 1);
  assert.equal(result.totalFundingQuote, -5_000);
  // The unrealized basis is not paid out after a liquidation.
  close(result.basisPnlQuote, 0);
  assert.equal(result.netPnlQuote, -5_000 - result.costsQuote);
  assert.ok(result.reasons.some((reason) => reason.includes("liquidata")));
  // The margin account left is below the maintenance requirement, as it must be.
  const maintenance = 0.005 * 10_000;
  assert.ok(result.equityAtLiquidationQuote !== null && result.equityAtLiquidationQuote <= maintenance);
  // Margin = perp margin + funding − the perpetual leg's entry half (7, not the
  // 14 round trip and not the 14 charged to the whole strategy at entry).
  close(result.perpCostsQuote, 14);
  close(result.entryCostsQuote, 14);
  close(result.perpEntryCostsQuote, 7);
  close(result.equityAtLiquidationQuote ?? Number.NaN, 10_000 / 3 - 5_000 - 7);
});

test("the margin account bears the perpetual leg's costs only, never the spot leg's", () => {
  // Unequal legs make the attribution visible: spot costs are 14, the perp round
  // trip is 8.4, so the perp margin must lose only 4.2 on entry. Charging the spot
  // cost there would liquidate a position that is still solvent.
  const result = run({ perpNotionalQuote: 6_000, fundingRates: [-0.5] });
  close(result.spotCostsQuote, 14);
  close(result.perpCostsQuote, 8.4);
  close(result.perpEntryCostsQuote, 4.2);
  close(result.entryCostsQuote, (14 + 8.4) / 2);
  close(result.exitCostsQuote, (14 + 8.4) / 2);
  assert.equal(result.liquidated, true);
  assert.equal(result.ok, false);
  close(result.equityAtLiquidationQuote ?? Number.NaN, 6_000 / 3 - 3_000 - 4.2);
  // The spot entry cost appears in the strategy P&L, not in the margin account.
  close(result.periods[0].equityQuote, -3_000 - (14 + 8.4) / 2);
});

test("entry and exit costs together are the full round trip", () => {
  const result = run();
  close(result.entryCostsQuote + result.exitCostsQuote, result.costsQuote);
  close(result.entryCostsQuote, 14);
});

test("a liquidation on a later period keeps only the periods before it", () => {
  const result = run({ fundingRates: [0.001, 0.001, -3, 0.001] });
  assert.equal(result.liquidated, true);
  assert.equal(result.liquidationIndex, 2);
  assert.equal(result.periods.length, 3);
  assert.equal(result.periods[2].index, 2);
});

test("the model states the limitation it cannot simulate", () => {
  const result = run();
  assert.ok(result.limitations.some((limitation) => limitation.includes("basis")));
});

test("max drawdown includes the entry costs, not just the funding swings", () => {
  const result = run();
  // The curve charges the entry half of the round trip up front: 14 quote. After the
  // first payment the curve is 1 - 14, so the trough (and the drawdown from zero) is 13.
  close(result.maxDrawdownQuote, 13);
  close(result.worstPeriodQuote, 1 - 14);
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

test("an empty leg, zero leverage or an impossible maintenance margin is refused", () => {
  assert.equal(run({ spotNotionalQuote: 0 }).ok, false);
  assert.equal(run({ perpNotionalQuote: -1 }).ok, false);
  assert.equal(run({ leverage: 0 }).ok, false);
  assert.equal(run({ maintenanceMarginPct: 100 }).ok, false);
});

test("fractional intervals or legs are refused", () => {
  assert.equal(run({ intervalsPerDay: 2.5 }).ok, false);
  assert.equal(run({ legsPerSide: 1.5 }).ok, false);
});

test("the simulation is deterministic: the same inputs produce the same curve", () => {
  const first = run({ fundingRates: [0.0001, -0.00005, 0.0002] });
  const second = run({ fundingRates: [0.0001, -0.00005, 0.0002] });
  assert.deepEqual(first, second);
});
