import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RISK_POLICY,
  blockedVerdict,
  evaluateRisk,
  type PortfolioState,
  type RiskPolicy,
  type TradeIntent,
} from "../src/lib/engine/risk-guard";
import { evaluatePaperRisk } from "../src/lib/engine/paper-risk";
import type { EngineSettings } from "../src/lib/config";

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

const run = (overrides: {
  intent?: Partial<TradeIntent>;
  portfolio?: Partial<PortfolioState>;
  policy?: Partial<RiskPolicy>;
} = {}) =>
  evaluateRisk({
    intent: { ...intent, ...overrides.intent },
    portfolio: { ...portfolio, ...overrides.portfolio },
    policy: { ...policy, ...overrides.policy },
  });

const blockedAsIncomplete = (verdict: ReturnType<typeof run>, fragment?: RegExp) => {
  assert.equal(verdict.approved, false);
  const dataViolation = verdict.violations.find((violation) => violation.code === "DATA_INCOMPLETE");
  assert.ok(dataViolation, `expected DATA_INCOMPLETE, got ${verdict.violations.map((v) => v.code).join(",")}`);
  if (fragment) assert.match(dataViolation.message, fragment);
};

/* -------------------------------------------------------------------------- */
/* Monetary limits cannot be bypassed with a non-positive size                 */
/* -------------------------------------------------------------------------- */

test("a negative notional is blocked instead of lowering exposure", () => {
  // Before the fix this passed: -1000 is under every cap and shrinks total and
  // venue exposure, so every monetary limit compared "after < limit".
  blockedAsIncomplete(run({ intent: { notionalQuote: -1000 } }), /notionalQuote deve essere maggiore di zero/);
});

test("a zero notional is blocked as a degenerate order", () => {
  blockedAsIncomplete(run({ intent: { notionalQuote: 0 } }), /notionalQuote deve essere maggiore di zero/);
});

test("a negative slippage cannot be used to pass the slippage limit", () => {
  blockedAsIncomplete(
    run({ intent: { expectedSlippagePct: -5 } }),
    /expectedSlippagePct non può essere negativo/,
  );
});

/* -------------------------------------------------------------------------- */
/* The drawdown limit cannot be switched off with an unusable equity peak      */
/* -------------------------------------------------------------------------- */

test("a zero equity peak blocks instead of skipping the drawdown check", () => {
  blockedAsIncomplete(
    run({ portfolio: { peakEquityQuote: 0, equityQuote: 0 } }),
    /peakEquityQuote deve essere maggiore di zero/,
  );
});

test("a negative equity peak blocks the intent", () => {
  blockedAsIncomplete(run({ portfolio: { peakEquityQuote: -500 } }));
});

test("a negative equity blocks the intent", () => {
  blockedAsIncomplete(run({ portfolio: { equityQuote: -1 } }), /equityQuote non può essere negativa/);
});

/* -------------------------------------------------------------------------- */
/* Kill switches and state are validated, not merely read                      */
/* -------------------------------------------------------------------------- */

test("a missing emergency stop flag blocks instead of meaning 'no stop'", () => {
  // Built and evaluated directly: `run()` merges over the base fixture, which would
  // put the flag back and hide exactly the case under test.
  const withoutFlag = { ...portfolio } as unknown as Record<string, unknown>;
  delete withoutFlag.emergencyStop;
  const verdict = evaluateRisk({
    intent,
    portfolio: withoutFlag as unknown as PortfolioState,
    policy,
  });
  blockedAsIncomplete(verdict, /emergencyStop deve essere esplicito/);
});

test("an unknown system state blocks instead of falling through to operational", () => {
  blockedAsIncomplete(
    run({ portfolio: { systemState: "paused" as PortfolioState["systemState"] } }),
    /systemState deve essere uno tra/,
  );
});

test("ordersLastHour must be a non-negative integer", () => {
  blockedAsIncomplete(run({ portfolio: { ordersLastHour: 1.5 } }), /intero non negativo/);
  blockedAsIncomplete(run({ portfolio: { ordersLastHour: -1 } }), /intero non negativo/);
});

/* -------------------------------------------------------------------------- */
/* Nested exposure numbers are validated entry by entry                        */
/* -------------------------------------------------------------------------- */

test("a negative venue exposure cannot offset the venue limit", () => {
  blockedAsIncomplete(
    run({ portfolio: { venueExposureQuote: { kraken: -900 } } }),
    /venueExposureQuote\["kraken"\] non può essere negativo/,
  );
});

test("a non-finite venue exposure blocks the intent", () => {
  blockedAsIncomplete(
    run({ portfolio: { venueExposureQuote: { coinbase: Number.POSITIVE_INFINITY } } }),
    /non è un numero finito/,
  );
});

test("a non-finite strategy exposure blocks the intent", () => {
  blockedAsIncomplete(
    run({ portfolio: { strategyExposureQuote: { "cross-exchange-arbitrage": Number.NaN } } }),
    /strategyExposureQuote\["cross-exchange-arbitrage"\] non è un numero finito/,
  );
});

test("an exposure map that is not an object blocks the intent", () => {
  blockedAsIncomplete(
    run({ portfolio: { venueExposureQuote: [] as unknown as Record<string, number> } }),
    /deve essere una mappa di importi/,
  );
});

/* -------------------------------------------------------------------------- */
/* Still fail-closed, still not over-blocking                                  */
/* -------------------------------------------------------------------------- */

test("a valid intent is still approved after the hardening", () => {
  const verdict = run();
  assert.equal(verdict.approved, true);
  assert.deepEqual(verdict.violations, []);
});

test("live intents stay refused by the permanent lock", () => {
  const verdict = run({ intent: { mode: "live" } });
  assert.equal(verdict.approved, false);
  assert.ok(verdict.violations.some((violation) => violation.code === "LIVE_EXECUTION_DISABLED"));
});

test("blockedVerdict reports a blocking code and never approves", () => {
  const verdict = blockedVerdict("DATA_INCOMPLETE", "dato corrotto");
  assert.equal(verdict.approved, false);
  assert.equal(verdict.violations[0]?.code, "DATA_INCOMPLETE");
  assert.equal(verdict.checksEvaluated, 0);
});

/* -------------------------------------------------------------------------- */
/* Paper integration: corrupted persisted rows block instead of becoming zero  */
/* -------------------------------------------------------------------------- */

const settings = {
  maxOrderQuote: 500,
  maxOrdersPerHour: 10,
  maxDailyLossQuote: 25,
  maxSlippagePct: 0.6,
  maxDataAgeMs: 20_000,
  monitoringEnabled: true,
} as unknown as EngineSettings;

const evaluation = {
  pair: "BTC/USD",
  buyVenue: "kraken",
  sellVenue: "coinbase",
  notionalQuote: 100,
  buySlippagePct: 0.2,
  sellSlippagePct: 0.2,
  dataAgeMs: 1000,
  rejectReasons: [] as string[],
};

const paperInput = {
  settings,
  evaluation,
  buyFeeConfidence: "verified" as const,
  sellFeeConfidence: "verified" as const,
  ordersLastHour: 0,
  now: Date.UTC(2026, 10, 6, 12, 0, 0),
};

test("a corrupted closed position blocks a paper open instead of counting as flat", () => {
  const verdict = evaluatePaperRisk({
    ...paperInput,
    openPositions: [],
    closedPositions: [{ realized_profit: Number.NaN, closed_at: "2026-11-06T10:00:00.000Z" }],
  });
  assert.equal(verdict.approved, false);
  assert.equal(verdict.violations[0]?.code, "DATA_INCOMPLETE");
});

test("a corrupted open position blocks a paper open", () => {
  const verdict = evaluatePaperRisk({
    ...paperInput,
    openPositions: [{ notional: Number.POSITIVE_INFINITY, buy_venue: "kraken", sell_venue: "coinbase" }],
    closedPositions: [],
  });
  assert.equal(verdict.approved, false);
  assert.equal(verdict.violations[0]?.code, "DATA_INCOMPLETE");
});

test("a clean paper portfolio is still approved", () => {
  const verdict = evaluatePaperRisk({
    ...paperInput,
    openPositions: [],
    closedPositions: [{ realized_profit: -5, closed_at: "2026-11-06T10:00:00.000Z" }],
  });
  assert.equal(verdict.approved, true, JSON.stringify(verdict.violations));
});
