import test from "node:test";
import assert from "node:assert/strict";
import {
  annualiseFundingRate,
  basisPct,
  evaluateFundingOpportunity,
  fundingHistoryStats,
  validateFundingHistory,
  type FundingObservation,
  type FundingOpportunityInput,
} from "../src/lib/engine/funding";

// Percentages accumulate floating-point error; compare with an explicit tolerance
// instead of hoping the arithmetic is exact.
const close = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

const NOW = 1_800_000_000_000;

const input: FundingOpportunityInput = {
  venueId: "okx",
  instrumentId: "BTC-USDT-SWAP",
  spot: { price: 60_000, dataAgeMs: 1000 },
  perpetual: {
    markPrice: 60_030,
    indexPrice: 60_000,
    fundingRate: 0.0001,
    nextFundingAt: NOW + 8 * 3600 * 1000,
    dataAgeMs: 1000,
  },
  nowMs: NOW,
  holdingDays: 30,
  intervalsPerDay: 3,
  feePctPerLeg: 0.05,
  slippagePctPerLeg: 0.02,
  legsPerSide: 2,
  maxDataAgeMs: 20_000,
  leverage: 3,
  maintenanceMarginPct: 0.5,
  minLiquidationBufferPct: 20,
  allowNegativeFunding: false,
};

const run = (overrides: Partial<FundingOpportunityInput> = {}) =>
  evaluateFundingOpportunity({ ...input, ...overrides });

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

test("annualising an 8h funding rate multiplies by intervals, days and 100", () => {
  assert.equal(annualiseFundingRate(0.0001, 3), 0.0001 * 3 * 365 * 100);
  assert.equal(annualiseFundingRate(0, 3), 0);
});

test("annualising refuses non-finite rates and a non-positive interval count", () => {
  assert.equal(annualiseFundingRate(Number.NaN, 3), null);
  assert.equal(annualiseFundingRate(0.0001, 0), null);
  assert.equal(annualiseFundingRate(0.0001, Number.POSITIVE_INFINITY), null);
});

test("basis is positive when the perpetual trades above spot", () => {
  assert.equal(basisPct(100, 101), 1);
  assert.equal(basisPct(100, 99), -1);
  assert.equal(basisPct(0, 99), null);
  assert.equal(basisPct(Number.NaN, 99), null);
});

test("an empty funding history has no statistics instead of neutral ones", () => {
  assert.equal(fundingHistoryStats([]), null);
});

test("a perfectly stable positive history scores the maximum persistence", () => {
  const observations: FundingObservation[] = [0.0001, 0.0001, 0.0001].map((rate, index) => ({
    rate,
    at: NOW + index * 8 * 3600 * 1000,
  }));
  const stats = fundingHistoryStats(observations);
  assert.ok(stats);
  assert.equal(stats.count, 3);
  assert.equal(stats.meanRate, 0.0001);
  assert.equal(stats.medianRate, 0.0001);
  assert.equal(stats.stdevRate, 0);
  assert.equal(stats.positiveShare, 1);
  assert.equal(stats.signFlips, 0);
  assert.equal(stats.worstRate, 0.0001);
  assert.equal(stats.persistenceScore, 100);
});

test("a history that changes sign loses persistence and counts the flips", () => {
  const observations: FundingObservation[] = [
    { rate: 0.0001, at: NOW },
    { rate: -0.0001, at: NOW + 1 },
    { rate: 0.0001, at: NOW + 2 },
  ];
  const stats = fundingHistoryStats(observations);
  assert.ok(stats);
  assert.equal(stats.signFlips, 2);
  assert.equal(stats.positiveShare, 2 / 3);
  assert.ok(stats.persistenceScore < 100);
});

test("a corrupt history is refused as a whole, never reduced to its valid subset", () => {
  const corrupt: unknown[] = [
    [{ rate: Number.NaN, at: NOW }, { rate: 0.0001, at: NOW + 1 }],
    [{ rate: 0.0001, at: NOW }, { rate: 0.0001, at: Number.NaN }],
    [{ rate: 0.0001, at: NOW }, { rate: 0.0001, at: -1 }],
    [{ rate: 0.0001, at: NOW }, { rate: 0.0001, at: NOW + 0.5 }],
    [{ rate: 0.0001, at: NOW }, { rate: 0.0001, at: NOW }],
    [{ rate: 0.0001, at: NOW }, null],
    [undefined],
  ];
  for (const observations of corrupt) {
    const validation = validateFundingHistory(observations as FundingObservation[]);
    assert.equal(validation.ok, false, JSON.stringify(observations));
    assert.ok(validation.ok === false && validation.reasons.length > 0);
    assert.equal(fundingHistoryStats(observations as FundingObservation[]), null);
    assert.equal(
      validateFundingHistory(observations as FundingObservation[]).ok,
      false,
      "una serie corrotta non deve poter diventare stabile",
    );
  }
});

test("a valid history is accepted even when its observations are not sorted", () => {
  const validation = validateFundingHistory([
    { rate: 0.0001, at: NOW + 1 },
    { rate: 0.0002, at: NOW },
  ]);
  assert.equal(validation.ok, true);
  assert.ok(validation.ok === true && validation.stats.count === 2);
});

test("an even number of observations uses the mean of the two central rates", () => {
  const stats = fundingHistoryStats([
    { rate: 0.0001, at: NOW },
    { rate: 0.0003, at: NOW + 1 },
  ]);
  assert.ok(stats);
  close(stats.medianRate, 0.0002);
});

/* -------------------------------------------------------------------------- */
/* Opportunity evaluation                                                     */
/* -------------------------------------------------------------------------- */

test("a funded carry reports its full decomposition", () => {
  const result = run();
  assert.equal(result.ok, true, result.reasons.join(" "));
  close(result.grossFundingPct, 0.9);
  close(result.costPct, 0.28);
  close(result.netPct, 0.62);
  assert.ok(Math.abs(result.netAprPct - (0.62 * 365) / 30) < 1e-9);
  assert.ok(Math.abs(result.basisPct - 0.05) < 1e-9);
  assert.ok(Math.abs(result.breakevenDays - 0.28 / 0.03) < 1e-9);
  assert.ok(Math.abs(result.liquidationBufferPct - (100 / 3 - 0.5)) < 1e-9);
  assert.equal(result.direction, "short-perp-receives");
});

test("negative funding is refused because the short leg pays instead of collecting", () => {
  const result = run({
    perpetual: { ...input.perpetual, fundingRate: -0.0001 },
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes("Funding negativo")));
  assert.equal(result.direction, "long-perp-pays");
});

test("negative funding can be allowed explicitly, and only then", () => {
  const result = run({
    perpetual: { ...input.perpetual, fundingRate: -0.0001 },
    allowNegativeFunding: true,
  });
  // Costs still exceed the (negative) funding, so it is refused for economics rather
  // than for direction.
  assert.equal(result.ok, false);
  assert.ok(!result.reasons.some((reason) => reason.includes("Funding negativo")));
});

test("stale market data blocks the carry", () => {
  const result = run({ spot: { price: 60_000, dataAgeMs: 60_000 } });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes("Dati obsoleti")));
});

test("leverage that leaves no room before liquidation blocks the carry", () => {
  const result = run({ leverage: 50 });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes("Buffer di liquidazione")));
});

test("costs larger than the funding collected block the carry", () => {
  const result = run({ holdingDays: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes("non positivo")));
  close(result.breakevenDays, 0.28 / 0.03);
});

test("a zero funding rate has no breakeven horizon", () => {
  const result = run({ perpetual: { ...input.perpetual, fundingRate: 0 } });
  assert.equal(result.ok, false);
  assert.equal(result.breakevenDays, Number.POSITIVE_INFINITY);
});

test("unusable prices are refused", () => {
  assert.equal(run({ spot: { price: 0, dataAgeMs: 0 } }).ok, false);
  assert.equal(run({ perpetual: { ...input.perpetual, markPrice: -1 } }).ok, false);
});

test("a non-finite or non-positive index price blocks the basis check", () => {
  for (const indexPrice of [0, -1, Number.NaN]) {
    const result = run({ perpetual: { ...input.perpetual, indexPrice } });
    assert.equal(result.ok, false, String(indexPrice));
    assert.ok(result.reasons.some((reason) => reason.includes("indexPrice")));
  }
});

test("non-finite inputs are refused with the offending field named", () => {
  const result = run({ perpetual: { ...input.perpetual, fundingRate: Number.NaN } });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes("perpetual.fundingRate")));
});

test("a missing settlement time blocks planning", () => {
  const result = run({ perpetual: { ...input.perpetual, nextFundingAt: 0 } });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes("nextFundingAt")));
});

test("a negative, zero or fractional reference time is refused", () => {
  for (const nowMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = run({ nowMs });
    assert.equal(result.ok, false, String(nowMs));
    assert.ok(result.reasons.some((reason) => reason.includes("nowMs")), String(nowMs));
  }
});

test("a fractional settlement timestamp is refused", () => {
  const result = run({ perpetual: { ...input.perpetual, nextFundingAt: NOW + 0.5 } });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes("nextFundingAt")));
});

test("an extreme reference time still rejects a settlement in its past", () => {
  const result = run({
    nowMs: NOW + 1_000_000_000,
    perpetual: { ...input.perpetual, nextFundingAt: NOW },
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes("precede nowMs")));
});

test("a settlement in the past or implausibly far away is refused", () => {
  const past = run({ perpetual: { ...input.perpetual, nextFundingAt: NOW - 1 } });
  assert.equal(past.ok, false);
  assert.ok(past.reasons.some((reason) => reason.includes("precede nowMs")));

  const far = run({ perpetual: { ...input.perpetual, nextFundingAt: NOW + 49 * 3600 * 1000 } });
  assert.equal(far.ok, false);
  assert.ok(far.reasons.some((reason) => reason.includes("oltre 48 ore")));

  // Without an explicit reference time, the comparison cannot be made at all.
  const noReference = run({ nowMs: Number.NaN });
  assert.equal(noReference.ok, false);
  assert.ok(noReference.reasons.some((reason) => reason.includes("nowMs")));
});

test("missing identifiers are refused instead of producing an anonymous signal", () => {
  for (const override of [{ venueId: "" }, { venueId: "   " }, { instrumentId: "" }]) {
    const result = run(override as Partial<FundingOpportunityInput>);
    assert.equal(result.ok, false, JSON.stringify(override));
    assert.ok(result.reasons.some((reason) => reason.includes("mancante")));
  }
});

test("fractional intervals or legs are refused", () => {
  assert.equal(run({ intervalsPerDay: 2.5 }).ok, false);
  assert.equal(run({ legsPerSide: 1.5 }).ok, false);
});

test("a non-boolean funding direction flag is refused", () => {
  const result = run({ allowNegativeFunding: "false" as unknown as boolean });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes("allowNegativeFunding")));
});

test("the net result is annualised from the stated horizon, not assumed", () => {
  // 15 days: 0.45% of funding against 0.28% of costs, so the carry is real. Seven
  // days would collect only 0.21% and must stay refused.
  const fortnight = run({ holdingDays: 15 });
  assert.equal(fortnight.ok, true, fortnight.reasons.join(" "));
  close(fortnight.grossFundingPct, 0.0001 * 100 * 3 * 15);
  assert.ok(Math.abs(fortnight.netAprPct - fortnight.netPct * (365 / 15)) < 1e-9);

  assert.equal(run({ holdingDays: 7 }).ok, false);
});
