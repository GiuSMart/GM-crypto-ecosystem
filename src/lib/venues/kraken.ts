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
