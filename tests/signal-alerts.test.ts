import test from "node:test";
import assert from "node:assert/strict";
import { isAlertCooldownComplete, verifiedSignalAlerts } from "../src/lib/engine/signal-alerts";

const candidate = (overrides: Partial<{
  pair: string; buyVenue: string; sellVenue: string; netProfit: number; marginPct: number; executable: boolean;
}> = {}) => ({
  pair: "BTC/EUR",
  buyVenue: "kraken",
  sellVenue: "coinbase",
  netProfit: 2.5,
  marginPct: 0.25,
  executable: true,
  ...overrides,
});

test("only positive, finite, engine-approved executable signals can alert", () => {
  const alerts = verifiedSignalAlerts([
    candidate(),
    candidate({ pair: "ETH/EUR", executable: false }),
    candidate({ pair: "SOL/EUR", netProfit: 0 }),
    candidate({ pair: "XRP/EUR", netProfit: Number.NaN }),
    candidate({ pair: "ADA/EUR", marginPct: -0.1 }),
  ]);

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].pair, "BTC/EUR");
  assert.equal(alerts[0].key, "BTC/EUR|kraken|coinbase");
});

test("alerts are sorted by net result and capped to three", () => {
  const alerts = verifiedSignalAlerts([
    candidate({ pair: "BTC/EUR", netProfit: 1 }),
    candidate({ pair: "ETH/EUR", netProfit: 5 }),
    candidate({ pair: "SOL/EUR", netProfit: 3 }),
    candidate({ pair: "XRP/EUR", netProfit: 2 }),
  ]);

  assert.deepEqual(alerts.map((alert) => alert.pair), ["ETH/EUR", "SOL/EUR", "XRP/EUR"]);
});

test("per-route alert cooldown is respected", () => {
  const now = 1_000_000;
  assert.equal(isAlertCooldownComplete(null, now), true);
  assert.equal(isAlertCooldownComplete(now - 14 * 60_000, now), false);
  assert.equal(isAlertCooldownComplete(now - 15 * 60_000, now), true);
  assert.equal(isAlertCooldownComplete(Number.NaN, now), true);
});
