/**
 * Deterministic technical indicators.
 *
 * The AI layer is only allowed to *interpret* these numbers; it never invents
 * them. Therefore every function here is pure: same input, same output, no I/O,
 * no clock, no randomness, no model. Insufficient input yields `null` instead of
 * a made-up value, so a chart can never display a fabricated indicator.
 *
 * Conventions (documented because "RSI" alone is ambiguous):
 * - SMA/EMA series are aligned with the input: entry i refers to values[i], and
 *   leading entries are `null` until the window is complete.
 * - EMA is seeded with the SMA of the first `period` values, then
 *   `ema[i] = ema[i-1] + alpha * (values[i] - ema[i-1])`, alpha = 2/(period+1).
 * - RSI uses Wilder smoothing and returns `null` until `period` deltas exist.
 *   A flat series is neutral (50); no losses with gains present is 100; the
 *   mirror case is 0.
 * - ATR uses Wilder smoothing on true range.
 * - Bollinger uses the population standard deviation of the window.
 */

import type { Level } from "./arbitrage";

export type Series = (number | null)[];

const assertPeriod = (period: number, name = "period"): void => {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError(`${name} deve essere un intero maggiore o uguale a 1 (ricevuto ${period}).`);
  }
};

const allNull = (length: number): Series => Array.from({ length: Math.max(0, length) }, () => null);

const assertSeries = (values: number[], name = "values"): void => {
  if (!Array.isArray(values)) throw new RangeError(`${name} deve essere un array.`);
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new RangeError(`${name} contiene un valore non finito: gli indicatori non lavorano su dati mancanti.`);
    }
  }
};

/** Simple moving average, aligned with the input series. */
export function sma(values: number[], period: number): Series {
  assertPeriod(period);
  assertSeries(values);
  const out = allNull(values.length);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average seeded with the SMA of the first window. */
export function ema(values: number[], period: number): Series {
  assertPeriod(period);
  assertSeries(values);
  const out = allNull(values.length);
  if (values.length < period) return out;
  const alpha = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i];
  let previous = seed / period;
  out[period - 1] = previous;
  for (let i = period; i < values.length; i += 1) {
    previous = previous + alpha * (values[i] - previous);
    out[i] = previous;
  }
  return out;
}

/** Wilder's Relative Strength Index in [0, 100]. */
export function rsi(values: number[], period = 14): Series {
  assertPeriod(period);
  assertSeries(values);
  const out = allNull(values.length);
  if (values.length < period + 1) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = rsiFromAverages(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFromAverages(avgGain, avgLoss);
  }
  return out;
}

function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0 && avgGain === 0) return 50; // perfectly flat window: neutral
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export type MacdSeries = { macd: Series; signal: Series; histogram: Series };

/**
 * MACD line, signal line and histogram.
 * The signal EMA is computed over the compacted MACD line (the only valid
 * values) and then mapped back, so leading nulls never distort the average.
 */
export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdSeries {
  assertPeriod(fast, "fast");
  assertPeriod(slow, "slow");
  assertPeriod(signalPeriod, "signalPeriod");
  if (fast >= slow) throw new RangeError("fast deve essere minore di slow.");
  assertSeries(values);

  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const macdLine = allNull(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const f = fastEma[i];
    const s = slowEma[i];
    if (f !== null && s !== null) macdLine[i] = f - s;
  }

  // Compact the valid segment, smooth it, then place it back at its true index.
  const firstValid = macdLine.findIndex((v) => v !== null);
  const signal = allNull(values.length);
  const histogram = allNull(values.length);
  if (firstValid >= 0) {
    const compact = macdLine.slice(firstValid).map((v) => v as number);
    const smoothed = ema(compact, signalPeriod);
    for (let i = 0; i < smoothed.length; i += 1) {
      const value = smoothed[i];
      if (value === null) continue;
      const index = firstValid + i;
      signal[index] = value;
      histogram[index] = (macdLine[index] as number) - value;
    }
  }
  return { macd: macdLine, signal, histogram };
}

export type BollingerBand = {
  middle: number;
  upper: number;
  lower: number;
  /** (upper - lower) / middle * 100, the classic volatility squeeze measure. */
  bandwidthPct: number;
};

export type BollingerSeries = {
  middle: Series;
  upper: Series;
  lower: Series;
  bandwidthPct: Series;
};

/** Bollinger Bands using the population standard deviation of each window. */
export function bollinger(values: number[], period = 20, multiplier = 2): BollingerSeries {
  assertPeriod(period);
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError("multiplier deve essere un numero finito maggiore di zero.");
  }
  assertSeries(values);
  const middle = sma(values, period);
  const upper = allNull(values.length);
  const lower = allNull(values.length);
  const bandwidthPct = allNull(values.length);

  for (let i = period - 1; i < values.length; i += 1) {
    const mean = middle[i];
    if (mean === null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j += 1) variance += (values[j] - mean) ** 2;
    const deviation = Math.sqrt(variance / period);
    const up = mean + multiplier * deviation;
    const down = mean - multiplier * deviation;
    upper[i] = up;
    lower[i] = down;
    bandwidthPct[i] = mean > 0 ? ((up - down) / mean) * 100 : null;
  }
  return { middle, upper, lower, bandwidthPct };
}

/** Latest usable value of a series, or null when nothing is available yet. */
export function lastValue(series: Series): number | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i];
    if (value !== null && Number.isFinite(value)) return value;
  }
  return null;
}

/** True range per bar; the first bar has no previous close. */
export function trueRange(highs: number[], lows: number[], closes: number[]): number[] {
  assertSeries(highs, "highs");
  assertSeries(lows, "lows");
  assertSeries(closes, "closes");
  if (highs.length !== lows.length || highs.length !== closes.length) {
    throw new RangeError("highs, lows e closes devono avere la stessa lunghezza.");
  }
  const out: number[] = [];
  for (let i = 0; i < highs.length; i += 1) {
    if (highs[i] < lows[i]) throw new RangeError(`high < low alla barra ${i}: serie non valida.`);
    if (i === 0) {
      out.push(highs[i] - lows[i]);
      continue;
    }
    const previousClose = closes[i - 1];
    out.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - previousClose),
      Math.abs(lows[i] - previousClose),
    ));
  }
  return out;
}

/** Average True Range with Wilder smoothing, aligned with the input bars. */
export function atr(highs: number[], lows: number[], closes: number[], period = 14): Series {
  assertPeriod(period);
  const ranges = trueRange(highs, lows, closes);
  const out = allNull(ranges.length);
  if (ranges.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += ranges[i];
  let previous = seed / period;
  out[period - 1] = previous;
  for (let i = period; i < ranges.length; i += 1) {
    previous = (previous * (period - 1) + ranges[i]) / period;
    out[i] = previous;
  }
  return out;
}

/** Volume-weighted average price of an order-book side or a trade list. */
export function vwap(levels: Level[]): number | null {
  let notional = 0;
  let size = 0;
  for (const level of levels) {
    if (!Number.isFinite(level.price) || !Number.isFinite(level.size)) continue;
    if (level.price <= 0 || level.size <= 0) continue;
    notional += level.price * level.size;
    size += level.size;
  }
  return size > 0 ? notional / size : null;
}

/**
 * Order-book imbalance in [-1, 1] over the top `levels` of each side, measured on
 * quote notional so bids and asks of different prices stay comparable.
 * Positive means more resting demand than supply.
 */
export function orderBookImbalance(bids: Level[], asks: Level[], levels = 10): number | null {
  assertPeriod(levels, "levels");
  let bidNotional = 0;
  let askNotional = 0;
  for (const level of bids.slice(0, levels)) {
    if (Number.isFinite(level.price) && Number.isFinite(level.size) && level.price > 0 && level.size > 0) {
      bidNotional += level.price * level.size;
    }
  }
  for (const level of asks.slice(0, levels)) {
    if (Number.isFinite(level.price) && Number.isFinite(level.size) && level.price > 0 && level.size > 0) {
      askNotional += level.price * level.size;
    }
  }
  const total = bidNotional + askNotional;
  if (!(total > 0)) return null;
  return (bidNotional - askNotional) / total;
}

/** Percentage change between two prices; null instead of Infinity on bad input. */
export function pctChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / from) * 100;
}

/**
 * A single, auditable snapshot of every indicator for one series.
 * Used by the intelligence layer so it can quote real numbers verbatim.
 */
export type IndicatorSnapshot = {
  samples: number;
  sma: number | null;
  ema: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bollinger: BollingerBand | null;
};

export function snapshot(closes: number[], opts: { smaPeriod?: number; emaPeriod?: number; rsiPeriod?: number; bollingerPeriod?: number } = {}): IndicatorSnapshot {
  const smaPeriod = opts.smaPeriod ?? 20;
  const emaPeriod = opts.emaPeriod ?? 20;
  const rsiPeriod = opts.rsiPeriod ?? 14;
  const bollingerPeriod = opts.bollingerPeriod ?? 20;

  const bands = bollinger(closes, bollingerPeriod);
  const middle = lastValue(bands.middle);
  const upper = lastValue(bands.upper);
  const lower = lastValue(bands.lower);
  const bandWidth = lastValue(bands.bandwidthPct);
  const macdResult = macd(closes);

  return {
    samples: closes.length,
    sma: lastValue(sma(closes, smaPeriod)),
    ema: lastValue(ema(closes, emaPeriod)),
    rsi: lastValue(rsi(closes, rsiPeriod)),
    macd: lastValue(macdResult.macd),
    macdSignal: lastValue(macdResult.signal),
    macdHistogram: lastValue(macdResult.histogram),
    bollinger:
      middle !== null && upper !== null && lower !== null && bandWidth !== null
        ? { middle, upper, lower, bandwidthPct: bandWidth }
        : null,
  };
}
