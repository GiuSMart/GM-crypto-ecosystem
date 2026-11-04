import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../src/lib/config";
import { evaluatePaperRisk, type OpenPaperPosition, type ClosedPaperPosition } from "../src/lib/engine/paper-risk";

const now = Date.parse("2026-11-04T12:00:00.000Z");
const evaluation = {
  pair: "BTC/USD",
  buyVenue: "kraken",
  sellVenue: "coinbase",
  notionalQuote: 100,
  buySlippagePct: 0.1,
  sellSlippagePct: 0.2,
  dataAgeMs: 1500,
  rejectReasons: [] as string[],
};
const run = (overrides: {
  settings?: Partial<typeof DEFAULT_SETTINGS>;
  evaluation?: Partial<typeof evaluation>;
  buyFeeConfidence?: "verified" | "unverified" | "user";
  sellFeeConfidence?: "verified" | "unverified" | "user";
  openPositions?: OpenPaperPosition[];
  closedPositions?: ClosedPaperPosition[];
  ordersLastHour?: number;
} = {}) => evaluatePaperRisk({
  settings: { ...DEFAULT_SETTINGS, ...overrides.settings },
  evaluation: { ...evaluation, ...overrides.evaluation },
  buyFeeConfidence: overrides.buyFeeConfidence ?? "verified",
  sellFeeConfidence: overrides.sellFeeConfidence ?? "verified",
  openPositions: overrides.openPositions ?? [],
  closedPositions: overrides.closedPositions ?? [],
  ordersLastHour: overrides.ordersLastHour ?? 0,
  now,
});

const codes = (verdict: ReturnType<typeof run>) => verdict.violations.map((v) => v.code);

test("paper risk assessment approves a clean intent within the virtual budget", () => {
  const verdict = run();
  assert.equal(verdict.approved, true);
  assert.deepEqual(verdict.violations, []);
});

test("paper risk assessment enforces the rolling hourly order limit", () => {
  const verdict = run({ ordersLastHour: 10 });
  assert.equal(verdict.approved, false);
  assert.ok(codes(verdict).includes("ORDER_RATE_LIMIT"));
});
test("paper risk assessment enforces the configured order cap", () => {
  const verdict = run({ evaluation: { notionalQuote: 501 } });
  assert.equal(verdict.approved, false);
  assert.ok(codes(verdict).includes("ORDER_ABOVE_CAP"));
});

test("paper risk assessment includes open exposure on both venues", () => {
  const verdict = run({
    evaluation: { notionalQuote: 100 },
    openPositions: [{ notional: 450, buy_venue: "kraken", sell_venue: "bybit" }],
  });
  assert.equal(verdict.approved, false);
  assert.ok(codes(verdict).includes("VENUE_EXPOSURE_LIMIT"));
});

test("paper risk assessment blocks the daily loss limit using this user's closed trades", () => {
  const verdict = run({
    closedPositions: [{ realized_profit: -26, closed_at: "2026-11-04T10:00:00.000Z" }],
  });
  assert.equal(verdict.approved, false);
  assert.ok(codes(verdict).includes("DAILY_LOSS_LIMIT"));
});

test("paper risk assessment ignores realized P&L from previous UTC days for daily loss", () => {
  const verdict = run({
    closedPositions: [{ realized_profit: -50, closed_at: "2026-11-03T23:59:59.000Z" }],
  });
  assert.equal(verdict.approved, true);
});

test("paper risk assessment refuses unverified exchange fees", () => {
  const verdict = run({ sellFeeConfidence: "unverified" });
  assert.equal(verdict.approved, false);
  assert.ok(codes(verdict).includes("FEE_UNVERIFIED"));
});

test("paper risk assessment blocks stale data and incomplete depth", () => {
  const stale = run({ evaluation: { dataAgeMs: 20_001 } });
  assert.ok(codes(stale).includes("STALE_DATA"));
  const thin = run({ evaluation: { rejectReasons: ["Liquidità insufficiente sul book di vendita."] } });
  assert.ok(codes(thin).includes("INSUFFICIENT_LIQUIDITY"));
});

test("paper risk assessment treats monitoring-off as a system halt", () => {
  const verdict = run({ settings: { monitoringEnabled: false } });
  assert.equal(verdict.approved, false);
  assert.ok(codes(verdict).includes("SYSTEM_HALTED"));
});

test("paper risk assessment never changes the live execution lock", () => {
  const verdict = run();
  assert.equal(verdict.approved, true);
  // The assessment always creates mode=paper and has no route to executeLiveOrder.
  assert.ok(!codes(verdict).includes("LIVE_EXECUTION_DISABLED"));
});
