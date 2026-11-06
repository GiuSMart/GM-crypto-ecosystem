import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RISK_POLICY, type PortfolioState, type RiskPolicy } from "../src/lib/engine/risk-guard";
import {
  evaluateDeltaNeutralRisk,
  type DeltaNeutralRiskInput,
} from "../src/lib/engine/funding-risk";

const portfolio: PortfolioState = {
  dailyRealizedPnlQuote: 0,
  peakEquityQuote: 1000,
  equityQuote: 1000,
  totalExposureQuote: 0,
  venueExposureQuote: {},
  strategyExposureQuote: {},
  availableCapitalQuote: 1000,
  ordersLastHour: 0,
  systemState: "operational",
  emergencyStop: false,
};

const policy: RiskPolicy = {
  ...DEFAULT_RISK_POLICY,
  maxOrderQuote: 500,
  allowedVenues: ["okx"],
  allowedStrategies: ["funding-carry"],
};

const input: DeltaNeutralRiskInput = {
  venueId: "okx",
  pair: "BTC/USDT",
  spotNotionalQuote: 300,
  perpNotionalQuote: 300,
  fundingRate: 0.0001,
  liquidationBufferPct: 30,
  minLiquidationBufferPct: 20,
  maxImbalancePct: 1,
  allowNegativeFunding: false,
  dataAgeMs: 1000,
  feeVerified: true,
  liquidityComplete: true,
  portfolio,
  policy,
  context: "internal",
};

const run = (overrides: Partial<DeltaNeutralRiskInput> = {}) =>
  evaluateDeltaNeutralRisk({ ...input, ...overrides });

const codes = (result: ReturnType<typeof run>) => result.fundingViolations.map((v) => v.code);

test("a balanced, documented internal carry is approved", () => {
  const result = run();
  assert.equal(result.approved, true, JSON.stringify(result.fundingViolations));
  assert.equal(result.verdict.approved, true);
  assert.equal(result.imbalancePct, 0);
});

test("showing OKX carry data to a customer is blocked by the licence gate", () => {
  const result = run({ context: "customer-facing" });
  assert.equal(result.approved, false);
  assert.deepEqual(codes(result), ["LICENCE_BLOCKED"]);
  assert.match(result.fundingViolations[0].message, /consenso scritto/);
});

test("an unknown venue is blocked for customers and never granted implicitly", () => {
  const result = run({ venueId: "mystery-exchange", context: "customer-facing" });
  assert.equal(result.approved, false);
  assert.deepEqual(codes(result), ["LICENCE_BLOCKED"]);
});

test("an unbalanced pair is refused: a hedge that is not a hedge", () => {
  const result = run({ perpNotionalQuote: 330 });
  assert.equal(result.approved, false);
  assert.deepEqual(codes(result), ["LEG_IMBALANCE"]);
  assert.ok(result.imbalancePct > 9);
});

test("legs within the imbalance tolerance are accepted", () => {
  const result = run({ perpNotionalQuote: 301 });
  assert.equal(result.approved, true, JSON.stringify(result.fundingViolations));
});

test("a missing or negative leg is refused", () => {
  // An unusable leg also destroys the balance, so both codes are legitimate: the
  // point is that the position is refused and the leg problem is named.
  const broken: Partial<DeltaNeutralRiskInput>[] = [
    { spotNotionalQuote: 0 },
    { perpNotionalQuote: -5 },
    { spotNotionalQuote: Number.NaN },
  ];
  for (const override of broken) {
    const result = run(override);
    assert.equal(result.approved, false);
    assert.ok(codes(result).includes("LEG_NOTIONAL_INVALID"), JSON.stringify(codes(result)));
  }
});

test("negative funding is refused unless explicitly allowed", () => {
  assert.deepEqual(codes(run({ fundingRate: -0.0001 })), ["NEGATIVE_FUNDING"]);
  const allowed = run({ fundingRate: -0.0001, allowNegativeFunding: true });
  assert.ok(!codes(allowed).includes("NEGATIVE_FUNDING"));
});

test("a buffer too close to liquidation is refused", () => {
  assert.deepEqual(codes(run({ liquidationBufferPct: 5 })), ["LIQUIDATION_BUFFER"]);
});

test("the portfolio limits still come from the Risk Guard, not from this module", () => {
  const result = run({ portfolio: { ...portfolio, ordersLastHour: 500 } });
  assert.equal(result.approved, false);
  assert.ok(result.verdict.violations.some((violation) => violation.code === "ORDER_RATE_LIMIT"));
});

test("the larger leg is the notional given to the guard", () => {
  const result = run({
    spotNotionalQuote: 600,
    perpNotionalQuote: 600,
    maxImbalancePct: 1,
  });
  assert.equal(result.approved, false);
  assert.ok(result.verdict.violations.some((violation) => violation.code === "ORDER_ABOVE_CAP"));
});

test("a strategy missing from the policy is not authorized", () => {
  const result = run({ policy: { ...policy, allowedStrategies: ["cross-exchange-arbitrage"] } });
  assert.equal(result.approved, false);
  assert.ok(result.verdict.violations.some((violation) => violation.code === "STRATEGY_NOT_AUTHORIZED"));
});

test("unverified fees block through the guard", () => {
  const result = run({ feeVerified: false });
  assert.equal(result.approved, false);
  assert.ok(result.verdict.violations.some((violation) => violation.code === "FEE_UNVERIFIED"));
});

test("the intent produced is paper-only and cannot request live execution", () => {
  // The module never exposes a mode parameter; the guard also refuses live intents.
  const result = run();
  assert.equal(result.approved, true);
  assert.ok(!result.verdict.violations.some((violation) => violation.code === "LIVE_EXECUTION_DISABLED"));
});

test("several independent problems are all reported, not just the first", () => {
  const result = run({
    context: "customer-facing",
    perpNotionalQuote: 400,
    fundingRate: -0.0001,
    liquidationBufferPct: 1,
  });
  assert.equal(result.approved, false);
  assert.deepEqual(codes(result).sort(), [
    "LEG_IMBALANCE",
    "LICENCE_BLOCKED",
    "LIQUIDATION_BUFFER",
    "NEGATIVE_FUNDING",
  ]);
});
