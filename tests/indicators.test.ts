import test from "node:test";
import assert from "node:assert/strict";
import {
  atr,
  bollinger,
  ema,
  lastValue,
  macd,
  orderBookImbalance,
  pctChange,
  rsi,
  sma,
  snapshot,
  trueRange,
  vwap,
} from "../src/lib/engine/indicators";

const close = (actual: number | null, expected: number, tolerance = 1e-9) => {
  assert.ok(actual !== null, "value should not be null");
  assert.ok(Math.abs(actual - expected) < tolerance, `expected ${expected}, got ${actual}`);
};

/* -------------------------------------------------------------------------- */
/* Moving averages                                                             */
/* -------------------------------------------------------------------------- */

test("sma aligns with the input and leaves the incomplete window null", () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test("sma returns all nulls when there are fewer samples than the window", () => {
  assert.deepEqual(sma([1, 2], 3), [null, null]);
});

test("ema is seeded with the sma and then smoothed with alpha = 2/(n+1)", () => {
  // seed at index 2 = mean(1,2,3) = 2; alpha = 0.5 -> 3 then 4
  assert.deepEqual(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test("ema of a constant series stays on that constant", () => {
  const series = ema([7, 7, 7, 7, 7, 7], 3);
  close(lastValue(series), 7);
});

/* -------------------------------------------------------------------------- */
/* RSI                                                                         */
/* -------------------------------------------------------------------------- */

test("rsi is 100 for a monotonically rising series", () => {
  const series = rsi([1, 2, 3, 4, 5], 2);
  assert.equal(series[0], null);
  assert.equal(series[1], null);
  assert.equal(series[2], 100);
  assert.equal(series[4], 100);
});

test("rsi is 0 for a monotonically falling series", () => {
  const series = rsi([5, 4, 3, 2, 1], 2);
  assert.equal(series[2], 0);
  assert.equal(series[4], 0);
});

test("rsi on a perfectly flat series is neutral (50), not 100", () => {
  const series = rsi([5, 5, 5, 5, 5], 2);
  assert.equal(series[2], 50);
  assert.equal(series[4], 50);
});

test("rsi needs period+1 samples and returns nulls otherwise", () => {
  assert.deepEqual(rsi([1, 2, 3], 14), [null, null, null]);
});

test("rsi stays inside 0..100 on mixed data", () => {
  const series = rsi([10, 11, 10.5, 12, 11.8, 12.4, 12.1, 12.9], 3);
  for (const value of series) {
    if (value === null) continue;
    assert.ok(value >= 0 && value <= 100, `rsi out of range: ${value}`);
  }
});

/* -------------------------------------------------------------------------- */
/* MACD                                                                        */
/* -------------------------------------------------------------------------- */

test("macd line only exists once the slow ema exists", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  const { macd: line, signal, histogram } = macd(closes);
  assert.equal(line.length, closes.length);
  assert.equal(signal.length, closes.length);
  assert.equal(histogram.length, closes.length);
  assert.equal(line[24], null, "slow ema (26) is not ready at index 24");
  assert.ok(line[25] !== null);
});

test("macd is positive on a rising series and the histogram starts after the signal", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  const { macd: line, histogram } = macd(closes);
  assert.ok((lastValue(line) ?? 0) > 0);
  assert.equal(histogram[24], null);
  // The macd line starts at index 25, so the 9-value signal seed lands at 33.
  assert.equal(histogram[32], null, "signal needs 9 valid macd values");
  assert.ok(histogram[33] !== null);
});

test("macd rejects fast >= slow", () => {
  assert.throws(() => macd([1, 2, 3], 26, 12), RangeError);
});

/* -------------------------------------------------------------------------- */
/* Bollinger                                                                   */
/* -------------------------------------------------------------------------- */

test("bollinger uses the population standard deviation of the window", () => {
  const bands = bollinger([1, 2, 3], 3, 2);
  const sd = Math.sqrt(2 / 3);
  close(bands.middle[2], 2);
  close(bands.upper[2], 2 + 2 * sd);
  close(bands.lower[2], 2 - 2 * sd);
  close(bands.bandwidthPct[2], ((2 * 2 * sd) / 2) * 100);
  assert.equal(bands.middle[1], null);
});

test("bollinger bands stay null until the window is complete", () => {
  const bands = bollinger([1, 2], 5);
  assert.deepEqual(bands.middle, [null, null]);
  assert.deepEqual(bands.upper, [null, null]);
});

/* -------------------------------------------------------------------------- */
/* ATR                                                                         */
/* -------------------------------------------------------------------------- */

test("true range uses the previous close for gaps", () => {
  // bar 1 gaps up: max(11-10=1, |11-9.5|=1.5, |10-9.5|=0.5) = 1.5
  assert.deepEqual(trueRange([10, 11, 12], [9, 10, 11], [9.5, 10.5, 11.5]), [1, 1.5, 1.5]);
});

test("true range rejects mismatched lengths and inverted bars", () => {
  assert.throws(() => trueRange([10, 11], [9], [9.5, 10]), RangeError);
  assert.throws(() => trueRange([9], [10], [9.5]), RangeError);
});

test("atr applies Wilder smoothing to the true range", () => {
  const series = atr([10, 11, 12], [9, 10, 11], [9.5, 10.5, 11.5], 2);
  assert.equal(series[0], null);
  close(series[1], 1.25);
  close(series[2], 1.375);
});

/* -------------------------------------------------------------------------- */
/* Order book and price helpers                                                */
/* -------------------------------------------------------------------------- */

test("vwap weights each level by its size", () => {
  close(vwap([{ price: 100, size: 1 }, { price: 101, size: 2 }]), (100 + 202) / 3);
});

test("vwap ignores empty, zero and non-finite levels", () => {
  assert.equal(vwap([]), null);
  assert.equal(vwap([{ price: 0, size: 1 }]), null);
  close(vwap([{ price: 10, size: 1 }, { price: Number.NaN, size: 5 }]), 10);
});

test("order book imbalance is negative when supply outweighs demand", () => {
  const value = orderBookImbalance([{ price: 100, size: 1 }], [{ price: 101, size: 1 }], 10);
  close(value, (100 - 101) / 201);
  assert.ok((value ?? 0) < 0);
});

test("order book imbalance is null when both sides are empty", () => {
  assert.equal(orderBookImbalance([], []), null);
});

test("pctChange never returns Infinity", () => {
  close(pctChange(100, 110), 10);
  assert.equal(pctChange(0, 110), null);
  assert.equal(pctChange(Number.NaN, 110), null);
});

/* -------------------------------------------------------------------------- */
/* Guards against fabricated values                                            */
/* -------------------------------------------------------------------------- */

test("indicators refuse non-finite inputs instead of propagating NaN", () => {
  assert.throws(() => sma([1, Number.NaN, 3], 2), RangeError);
  assert.throws(() => ema([1, Number.POSITIVE_INFINITY], 2), RangeError);
});

test("indicators reject invalid periods", () => {
  assert.throws(() => sma([1, 2, 3], 0), RangeError);
  assert.throws(() => rsi([1, 2, 3], 2.5), RangeError);
  assert.throws(() => bollinger([1, 2, 3], 3, 0), RangeError);
});

test("snapshot reports nulls instead of inventing values on short history", () => {
  const empty = snapshot([]);
  assert.equal(empty.samples, 0);
  assert.equal(empty.sma, null);
  assert.equal(empty.rsi, null);
  assert.equal(empty.bollinger, null);

  const short = snapshot([1, 2, 3]);
  assert.equal(short.sma, null);
  assert.equal(short.rsi, null);
  assert.equal(short.macd, null);
});

test("snapshot exposes every indicator from the same series", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
  const snap = snapshot(closes);
  assert.equal(snap.samples, 60);
  assert.ok(snap.sma !== null);
  assert.ok(snap.ema !== null);
  assert.ok(snap.rsi !== null && snap.rsi >= 0 && snap.rsi <= 100);
  assert.ok(snap.macd !== null);
  assert.ok(snap.macdSignal !== null);
  assert.ok(snap.macdHistogram !== null);
  assert.ok(snap.bollinger !== null);
  assert.ok((snap.bollinger?.upper ?? 0) > (snap.bollinger?.lower ?? 0));
});
