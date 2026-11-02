import { ASSETS, QUOTES } from "../config";
import { throttled } from "../rate-limit";
import type { Book } from "../engine/arbitrage";
import { toLevels, type Ticker, type VenueAdapter } from "./types";
import { assertAllowedVenueBase } from "./hosts";

const ORIGIN = assertAllowedVenueBase("https://api.kraken.com").origin;
const BASE = `${ORIGIN}/0/public`;
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
      // Refuse redirects: a 3xx could move a "public Kraken" call to another host.
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
  /** normalised pair ("BTC/USD") -> Kraken altname ("XBTUSD") */
  altnameByWs: Map<string, string>;
  /** Kraken result key ("XXBTZUSD") -> normalised pair ("BTC/USD") */
  wsByKey: Map<string, string>;
  /** normalised pair ("BTC/EUR") -> altname, restricted to assets/quotes we monitor */
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
    const [base, quote] = wsname.split("/");
    // Kraken keeps legacy prefixes in wsname (XBT/EUR, XDG/USD). Normalise once so the
    // discovery list, the ticker map and the book lookup all agree on BTC/EUR.
    const pair = `${normaliseBase(base)}/${quote}`;
    altnameByWs.set(pair, entry.altname);
    wsByKey.set(key, pair);
    if (
      (ASSETS as readonly string[]).includes(normaliseBase(base)) &&
      (QUOTES as readonly string[]).includes(quote)
    ) {
      supported.push(pair);
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

    const receivedAt = Date.now();
    // Kraken stamps every level with the snapshot time in Unix seconds. Validating that
    // value instead of trusting only the local clock keeps a cached or replayed response
    // from being accepted as fresh.
    const exchangeTs = Number(entry.asks[0]?.[2] ?? entry.bids[0]?.[2]) * 1000;
    if (!Number.isFinite(exchangeTs) || exchangeTs <= 0) {
      throw new Error("Kraken: timestamp del book mancante o non valido");
    }
    if (exchangeTs > receivedAt + 5000 || receivedAt - exchangeTs > 30_000) {
      throw new Error("Kraken: snapshot order book troppo vecchio o con timestamp anomalo");
    }

    const book: Book = {
      venue: "kraken",
      pair,
      asks: toLevels(entry.asks, "asks"),
      bids: toLevels(entry.bids, "bids"),
      // Snapshot time advertised by Kraken: an old book must look old to the engine.
      ts: exchangeTs,
    };
    if (!book.asks.length || !book.bids.length) throw new Error(`Kraken: book incompleto per ${pair}`);
    return book;
  },
};

export const krakenBaseMap = normaliseBase;
