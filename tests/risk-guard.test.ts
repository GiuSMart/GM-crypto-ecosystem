import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RISK_POLICY,
  LIVE_EXECUTION_ENABLED,
  evaluateRisk,
  summarizeVerdict,
  validateRiskPolicy,
  type PortfolioState,
  type RiskPolicy,
  type TradeIntent,
} from "../src/lib/engine/risk-guard";

const portfolio: PortfolioState = {
  dailyRealizedPnlQuote: 0,
  peakEquityQuote: 1000,
  equityQuote: 1000,
  totalExposureQuote: 0,
  venueExposureQuote: {},
  strategyExposureQuote: {},
  availableCapitalQuote: 1000,
  systemState: "operational",
  emergencyStop: false,
};

const intent: TradeIntent = {
  pair: "BTC/USD",
  buyVenue: "kraken",
  sellVenue: "coinbase",
  strategy: "cross-exchange-arbitrage",
  notionalQuote: 100,
  expectedSlippagePct: 0.2,
  feeVerified: true,
  dataAgeMs: 1500,
  liquidityComplete: true,
  mode: "paper",
};

const policy: RiskPolicy = { ...DEFAULT_RISK_POLICY };

const run = (overrides: { intent?: Partial<TradeIntent>; portfolio?: Partial<PortfolioState>; policy?: Partial<RiskPolicy> } = {}) =>
  evaluateRisk({
    intent: { ...intent, ...overrides.intent },
    portfolio: { ...portfolio, ...overrides.portfolio },
    policy: { ...policy, ...overrides.policy },
  });

const codes = (verdict: ReturnType<typeof run>) => verdict.violations.map((v) => v.code);

/* -------------------------------------------------------------------------- */
/* Happy path and the permanent live lock                                      */
/* -------------------------------------------------------------------------- */

test("a clean paper intent inside every limit is approved", () => {
  const verdict = run();
  assert.equal(verdict.approved, true);
  assert.deepEqual(verdict.violations, []);
  assert.equal(verdict.policyRejected, false);
  assert.ok(verdict.checksEvaluated >= 15);
});

test("live execution is refused even when every other check passes", () => {
  const verdict = run({ intent: { mode: "live" } });
  assert.equal(verdict.approved, false);
  assert.ok(codes(verdict).includes("LIVE_EXECUTION_DISABLED"));
});

test("the live lock is a compile-time constant, not a settings flag", () => {
  assert.equal(LIVE_EXECUTION_ENABLED, false);
  // A policy that wrongly claims not to be paper-only cannot open the live path:
  // the build constant still refuses it.
  const relaxedPolicy = run({ intent: { mode: "live" }, policy: { paperModeOnly: false } });
  assert.equal(relaxedPolicy.approved, false);
  assert.ok(codes(relaxedPolicy).includes("LIVE_EXECUTION_DISABLED"));
});

test("paper intents are not blocked by the live lock", () => {
  const verdict = run({ intent: { mode: "paper" }, policy: { paperModeOnly: false } });
  assert.equal(verdict.approved, true);
  assert.ok(!codes(verdict).includes("LIVE_EXECUTION_DISABLED"));
});

test("emergency stop overrides an otherwise valid intent", () => {
  const verdict = run({ portfolio: { emergencyStop: true } });
  assert.equal(verdict.approved, false);
  assert.ok(codes(verdict).includes("EMERGENCY_STOP_ACTIVE"));
});

test("halted system blocks, degraded system only warns", () => {
  const halted = run({ portfolio: { systemState: "halted" } });
  assert.equal(halted.approved, false);
  assert.ok(codes(halted).includes("SYSTEM_HALTED"));

  const degraded = run({ portfolio: { systemState: "degraded" } });
  assert.equal(degraded.approved, true);
  assert.ok(degraded.warnings.some((w) => w.code === "SYSTEM_DEGRADED"));
});

/* -------------------------------------------------------------------------- */
/* Authorizations and limits                                                   */
/* -------------------------------------------------------------------------- */

test("venues and strategies outside the policy are refused", () => {
  const verdict = run({ intent: { buyVenue: "okx", sellVenue: "revolut-x", strategy: "momentum" } });
  assert.equal(verdict.approved, false);
  assert.ok(codes(verdict).includes("BUY_VENUE_NOT_AUTHORIZED"));
  assert.ok(codes(verdict).includes("SELL_VENUE_NOT_AUTHORIZED"));
  assert.ok(codes(verdict).includes("STRATEGY_NOT_AUTHORIZED"));
});

test("notional above the per-order cap is refused, and 90% raises a warning", () => {
  const over = run({ intent: { notionalQuote: 501 } });
  assert.equal(over.approved, false);
  assert.ok(codes(over).includes("ORDER_ABOVE_CAP"));

  const near = run({ intent: { notionalQuote: 480 } });
  assert.equal(near.approved, true, "480 is under the 500 cap");
  assert.ok(near.warnings.some((w) => w.code === "NEAR_ORDER_CAP"));
});

test("the order must leave the configured free capital untouched", () => {
  const noCapital = run({ portfolio: { availableCapitalQuote: 90 } });
  assert.equal(noCapital.approved, false);
  assert.ok(codes(noCapital).includes("INSUFFICIENT_CAPITAL"));

  // 300 free - 100 order = 200 free, above the 100 minimum
  const ok = run({ portfolio: { availableCapitalQuote: 300 } });
  assert.equal(ok.approved, true);

  // 150 free - 100 order = 50 free, below the 100 minimum
  const thin = run({ portfolio: { availableCapitalQuote: 150 } });
  assert.equal(thin.approved, false);
  assert.ok(codes(thin).includes("INSUFFICIENT_CAPITAL"));
});

test("aggregate, venue and strategy exposure are each enforced", () => {
  const total = run({ portfolio: { totalExposureQuote: 950 } });
  assert.equal(total.approved, false);
  assert.ok(codes(total).includes("TOTAL_EXPOSURE_LIMIT"));

  const venue = run({ portfolio: { venueExposureQuote: { kraken: 450 } } });
  assert.equal(venue.approved, false);
  assert.ok(codes(venue).includes("VENUE_EXPOSURE_LIMIT"));

  const strategy = run({ portfolio: { strategyExposureQuote: { "cross-exchange-arbitrage": 700 } } });
  assert.equal(strategy.approved, false);
  assert.ok(codes(strategy).includes("STRATEGY_EXPOSURE_LIMIT"));
});

test("daily loss at the limit suspends trading, 80% only warns", () => {
  const breached = run({ portfolio: { dailyRealizedPnlQuote: -25 } });
  assert.equal(breached.approved, false);
  assert.ok(codes(breached).includes("DAILY_LOSS_LIMIT"));

  const near = run({ portfolio: { dailyRealizedPnlQuote: -20 } });
  assert.equal(near.approved, true);
  assert.ok(near.warnings.some((w) => w.code === "NEAR_DAILY_LOSS_LIMIT"));
});

test("drawdown is measured from peak equity", () => {
  // peak 1000, equity 900 -> 10% drawdown, exactly at the limit
  const breached = run({ portfolio: { peakEquityQuote: 1000, equityQuote: 900 } });
  assert.equal(breached.approved, false);
  assert.ok(codes(breached).includes("DRAWDOWN_LIMIT"));

  const near = run({ portfolio: { peakEquityQuote: 1000, equityQuote: 850 } });
  assert.equal(near.approved, false, "15% is beyond the 10% limit");
  assert.ok(codes(near).includes("DRAWDOWN_LIMIT"));
});

/* -------------------------------------------------------------------------- */
/* Data integrity: the guard must fail closed                                  */
/* -------------------------------------------------------------------------- */

test("an unverified fee blocks the intent", () => {
  const verdict = run({ intent: { feeVerified: false } });
  assert.equal(verdict.approved, false);
  assert.ok(codes(verdict).includes("FEE_UNVERIFIED"));
});

test("stale or future-dated market data blocks the intent", () => {
  const stale = run({ intent: { dataAgeMs: 20_001 } });
  assert.equal(stale.approved, false);
  assert.ok(codes(stale).includes("STALE_DATA"));

  const future = run({ intent: { dataAgeMs: -5 } });
  assert.equal(future.approved, false);
  assert.ok(codes(future).includes("STALE_DATA"));
});

test("incomplete liquidity and excessive slippage block the intent", () => {
  const thin = run({ intent: { liquidityComplete: false } });
  assert.equal(thin.approved, false);
  assert.ok(codes(thin).includes("INSUFFICIENT_LIQUIDITY"));

  const slippy = run({ intent: { expectedSlippagePct: 0.61 } });
  assert.equal(slippy.approved, false);
  assert.ok(codes(slippy).includes("SLIPPAGE_LIMIT"));
});

test("NaN anywhere in the numbers blocks the intent instead of defaulting", () => {
  const verdict = run({ intent: { notionalQuote: Number.NaN } });
  assert.equal(verdict.approved, false);
  assert.ok(codes(verdict).includes("DATA_INCOMPLETE"));
});

test("a non-finite portfolio balance cannot be used to approve anything", () => {
  const verdict = run({ portfolio: { availableCapitalQuote: Number.POSITIVE_INFINITY } });
  assert.equal(verdict.approved, false);
  assert.ok(codes(verdict).includes("DATA_INCOMPLETE"));
});

/* -------------------------------------------------------------------------- */
/* The policy itself                                                           */
/* -------------------------------------------------------------------------- */

test("the shipped default policy is valid", () => {
  assert.deepEqual(validateRiskPolicy(DEFAULT_RISK_POLICY), []);
});

test("an invalid policy rejects every intent, however clean the trade looks", () => {
  const negative = run({ policy: { maxOrderQuote: -1 } });
  assert.equal(negative.approved, false);
  assert.equal(negative.policyRejected, true);
  assert.ok(codes(negative).includes("POLICY_INVALID"));

  const noVenues = run({ policy: { allowedVenues: [] } });
  assert.equal(noVenues.approved, false);
  assert.equal(noVenues.policyRejected, true);

  // An order cap above total exposure could never be reached safely.
  const capAboveTotal = run({ policy: { maxOrderQuote: 900, maxTotalExposureQuote: 800 } });
  assert.equal(capAboveTotal.approved, false);
  assert.ok(codes(capAboveTotal).includes("POLICY_INVALID"));
});

test("drawdown limit must be a percentage below 100", () => {
  assert.ok(validateRiskPolicy({ ...DEFAULT_RISK_POLICY, maxDrawdownPct: 100 }).length > 0);
  assert.ok(validateRiskPolicy({ ...DEFAULT_RISK_POLICY, maxDrawdownPct: 0 }).length > 0);
});

/* -------------------------------------------------------------------------- */
/* Audit summary                                                               */
/* -------------------------------------------------------------------------- */

test("the summary names every blocking code and never reports approval on block", () => {
  const verdict = run({ intent: { feeVerified: false, mode: "live" } });
  const summary = summarizeVerdict(verdict);
  assert.ok(summary.includes("Bloccato dal Risk Guard"));
  assert.ok(summary.includes("LIVE_EXECUTION_DISABLED"));
  assert.ok(summary.includes("FEE_UNVERIFIED"));

  const approved = summarizeVerdict(run());
  assert.ok(approved.includes("Approvato dal Risk Guard"));
});
