import test from "node:test";
import assert from "node:assert/strict";
import { summarizeSignalPersistence } from "../src/lib/engine/signal-intelligence";

const observation = (ts: string, overrides: Partial<{
  pair: string; buy_venue: string; sell_venue: string; net_profit: number; margin_pct: number; executable: number;
}> = {}) => ({
  ts,
  pair: "BTC/EUR",
  buy_venue: "kraken",
  sell_venue: "coinbase",
  net_profit: 1.5,
  margin_pct: 0.15,
  executable: 1,
  ...overrides,
});

test("signal intelligence groups only identical routes and measures persistence", () => {
  const rows = summarizeSignalPersistence([
    observation("2026-10-01T10:00:00.000Z"),
    observation("2026-10-01T10:03:00.000Z", { net_profit: 1 }),
    observation("2026-10-01T10:07:00.000Z", { executable: 0, margin_pct: -0.02 }),
    observation("2026-10-01T10:08:00.000Z", { buy_venue: "bybit" }),
  ]);

  assert.equal(rows.length, 2);
  const primary = rows.find((row) => row.buyVenue === "kraken");
  assert.ok(primary);
  assert.equal(primary.samples, 3);
  assert.equal(primary.executableSamples, 2);
  assert.equal(primary.positiveNetSamples, 2);
  assert.equal(primary.durationMinutes, 7);
  assert.equal(primary.status, "Persistente");
  assert.ok(Math.abs(primary.averageNetProfit - (1.5 + 1 - 1.5) / 3) < 1e-10);
});

test("signal intelligence labels short-lived repeats as recurring, not persistent", () => {
  const rows = summarizeSignalPersistence([
    observation("2026-10-01T10:00:00.000Z"),
    observation("2026-10-01T10:01:00.000Z"),
  ]);

  assert.equal(rows[0].status, "Ricorrente");
  assert.equal(rows[0].durationMinutes, 1);
});

test("signal intelligence ignores non-finite observations and sorts most repeated routes first", () => {
  const rows = summarizeSignalPersistence([
    observation("2026-10-01T10:00:00.000Z", { net_profit: Number.NaN }),
    observation("2026-10-01T10:00:00.000Z", { pair: "ETH/EUR" }),
    observation("2026-10-01T10:01:00.000Z", { pair: "ETH/EUR" }),
    observation("2026-10-01T10:02:00.000Z", { pair: "ETH/EUR" }),
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].pair, "ETH/EUR");
  assert.equal(rows[0].samples, 3);
});
