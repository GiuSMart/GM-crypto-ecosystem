import { ASSETS, QUOTES } from "../config";
import { throttled } from "../rate-limit";
import type { Book } from "../engine/arbitrage";
import { toLevels, type Ticker, type VenueAdapter } from "./types";

const BASE = "https://api.kraken.com/0/public";
const UA = "GM-Crypto-Arbitrage-AI/0.1 (+research prototype; public market data only)";

/**
 * Kraken public REST.
 * Limits (documented): public endpoints are IP-based and ~1 request/second is safe,
 * so every call goes through a 1100ms-spaced queue.
 */
const SPACING = 1100;

async function krakenGet<T>(path: string): Promise<T> {
  return throttled("kraken", SPACING, async () => {
    const res = await fetch(`${BASE}/${path}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
    const json = (await res.json()) as { error: string[]; result: T };
    if (Array.isArray(json.error) && json.error.length > 0) throw new Error(`Kraken: ${json.error.join(", ")}`);
    return json.result;
  });
}

type AssetPairEntry = { altname: string; wsname?: string; base: string; quote: string; status: string };
type PairIndex = {
  /** wsname ("BTC/USD") -> Kraken altname ("XBTUSD") */
  altnameByWs: Map<string, string>;
  /** Kraken result key ("XXBTZUSD") -> wsname */
  wsByKey: Map<string, string>;
  /** wsname -> altname, restricted to assets/quotes we monitor */
  supported: string[];
};

let pairIndexCache: { ts: number; index: PairIndex } | null = null;
const PAIR_INDEX_TTL = 60 * 60 * 1000;

const normaliseBase = (krakenBase: string) => {
  const map: Record<string, string> = { XXBT: "BTC", XBT: "BTC", XETH: "ETH", XXDG: "DOGE", XDG: "DOGE" };
  const cleaned = krakenBase.replace(/^[XZ](?=[A-Z]{3,4}$)/, "");
  return map[krakenBase] ?? map[cleaned] ?? cleaned;
};

async function getPairIndex(): Promise<PairIndex> {
  if (pairIndexCache && Date.now() - pairIndexCache.ts < PAIR_INDEX_TTL) return pairIndexCache.index;
  const result = await krakenGet<Record<string, AssetPairEntry>>("AssetPairs");
  const altnameByWs = new Map<string, string>();
  const wsByKey = new Map<string, string>();
  const supported: string[] = [];

  for (const [key, entry] of Object.entries(result)) {
    if (entry.status !== "online") continue;
    const wsname = entry.wsname; // e.g. "BTC/USD"
    if (!wsname) continue;
    altnameByWs.set(wsname, entry.altname);
    wsByKey.set(key, wsname);
    const [base, quote] = wsname.split("/");
    if (
      (ASSETS as readonly string[]).includes(normaliseBase(base)) &&
      (QUOTES as readonly string[]).includes(quote)
    ) {
      supported.push(`${normaliseBase(base)}/${quote}`);
    }
  }
  const index: PairIndex = { altnameByWs, wsByKey, supported: [...new Set(supported)] };
  pairIndexCache = { ts: Date.now(), index };
  return index;
}

type TickerEntry = { a: string[]; b: string[]; c: string[] };

export type HistoricalCandle = {
  venue: "kraken";
  pair: string;
  intervalMinutes: number;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vwap: number;
  volume: number;
  trades: number;
};

type KrakenOhlcRow = [number, string, string, string, string, string, string, number];
type KrakenOhlcResult = { last: number } & Record<string, KrakenOhlcRow[] | number>;

/**
 * Fetch closed Kraken OHLC candles for internal research/backtesting only.
 * Kraken returns at most 720 recent rows; the currently-forming candle is excluded
 * so a backtest cannot accidentally consume a candle before its close.
 */
export async function getHistoricalCandles(input: {
  pair: string;
  intervalMinutes: number;
  since?: number;
  nowMs?: number;
}): Promise<{ candles: HistoricalCandle[]; last: number }> {
  const allowedIntervals = [1, 5, 15, 30, 60, 240, 1440, 10080, 21600];
  if (!allowedIntervals.includes(input.intervalMinutes)) {
    throw new RangeError("Intervallo OHLC Kraken non supportato.");
  }
  if (typeof input.pair !== "string" || !/^[A-Z0-9]{2,12}\\/[A-Z0-9]{2,12}$/.test(input.pair)) {
    throw new RangeError("Coppia di mercato non valida.");
  }
  if (input.since !== undefined && (!Number.isSafeInteger(input.since) || input.since < 0)) {
    throw new RangeError("Il parametro since deve essere un timestamp Unix in secondi valido.");
  }
  const index = await getPairIndex();
  const altname = index.altnameByWs.get(input.pair);
  if (!altname) throw new Error(`Kraken: coppia ${input.pair} non disponibile.`);

  const query = `OHLC?pair=${encodeURIComponent(altname)}&interval=${input.intervalMinutes}${
    input.since === undefined ? "" : `&since=${input.since}`
  }`;
  const result = await krakenGet<KrakenOhlcResult>(query);
  const resultKey = Object.keys(result).find((key) => key !== "last" && Array.isArray(result[key]));
  if (!resultKey) throw new Error("Kraken: risposta OHLC senza serie di candele.");
  const rows = result[resultKey] as KrakenOhlcRow[];
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const intervalSeconds = input.intervalMinutes * 60;
  const candles: HistoricalCandle[] = [];

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 8) throw new Error("Kraken: riga OHLC incompleta.");
    const [time, open, high, low, close, vwap, volume, trades] = row;
    const candle = {
      venue: "kraken" as const,
      pair: input.pair,
      intervalMinutes: input.intervalMinutes,
      openTime: Number(time),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      vwap: Number(vwap),
      volume: Number(volume),
      trades: Number(trades),
    };
    if (
      !Number.isSafeInteger(candle.openTime) ||
      candle.openTime < 0 ||
      ![candle.open, candle.high, candle.low, candle.close, candle.vwap, candle.volume, candle.trades].every(Number.isFinite) ||
      candle.open <= 0 ||
      candle.high < Math.max(candle.open, candle.close, candle.low) ||
      candle.low > Math.min(candle.open, candle.close, candle.high) ||
      candle.vwap <= 0 ||
      candle.volume < 0 ||
      candle.trades < 0
    ) {
      throw new Error("Kraken: candela OHLC con valori non validi.");
    }
    if (candle.openTime + intervalSeconds <= nowSeconds) candles.push(candle);
  }

  candles.sort((a, b) => a.openTime - b.openTime);
  return { candles, last: Number(result.last) };
}


export const kraken: VenueAdapter = {
  id: "kraken",
  displayName: "Kraken",
  minSpacingMs: SPACING,
  docs: "https://docs.kraken.com/exchange/api-reference/spot-rest",

  async discoverPairs() {
    const index = await getPairIndex();
    return index.supported;
  },

  async tickers(pairs: string[]) {
    const index = await getPairIndex();
    const wanted = pairs.filter((p) => index.altnameByWs.has(p));
    if (!wanted.length) return new Map();
    const query = wanted.map((p) => index.altnameByWs.get(p)!).join(",");
    const result = await krakenGet<Record<string, TickerEntry>>(`Ticker?pair=${encodeURIComponent(query)}`);
    const out = new Map<string, Ticker>();
    const now = Date.now();
    for (const [key, entry] of Object.entries(result)) {
      const ws = index.wsByKey.get(key);
      if (!ws) continue;
      const bid = Number(entry.b?.[0]);
      const ask = Number(entry.a?.[0]);
      const last = Number(entry.c?.[0]);
      if (!(bid > 0) || !(ask > 0)) continue;
      out.set(ws, { venue: "kraken", pair: ws, bid, ask, last: last || (bid + ask) / 2, ts: now });
    }
    return out;
  },

  async book(pair: string, depth = 25) {
    const index = await getPairIndex();
    const altname = index.altnameByWs.get(pair);
    if (!altname) throw new Error(`Kraken: coppia ${pair} non disponibile`);
    const result = await krakenGet<Record<string, { asks: [string, string, number][]; bids: [string, string, number][] }>>(
      `Depth?pair=${encodeURIComponent(altname)}&count=${depth}`,
    );
    const entry = Object.values(result)[0];
    if (!entry) throw new Error(`Kraken: order book vuoto per ${pair}`);
    const book: Book = {
      venue: "kraken",
      pair,
      asks: toLevels(entry.asks, "asks"),
      bids: toLevels(entry.bids, "bids"),
      ts: Date.now(),
    };
    if (!book.asks.length || !book.bids.length) throw new Error(`Kraken: book incompleto per ${pair}`);
    return book;
  },
};

export const krakenBaseMap = normaliseBase;
