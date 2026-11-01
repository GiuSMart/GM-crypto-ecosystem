import { ASSETS, QUOTES } from "../config";
import { throttled } from "../rate-limit";
import type { Book } from "../engine/arbitrage";
import { toLevels, type Ticker, type VenueAdapter } from "./types";

/**
 * Bybit V5 public Spot market data.
 * EEA accounts should use api.bybit.eu; the official docs note API-broker
 * restrictions for the EEA site's third-party-app connection flow.
 * Override only with an explicitly supported HTTPS host.
 */
const BASE = process.env.BYBIT_API_BASE?.trim() || "https://api.bybit.eu";
const ALLOWED_HOSTS = new Set(["api.bybit.eu", "api.bybit.com", "api.bytick.com", "api-testnet.bybit.com"]);
const parsedBase = new URL(BASE);
if (parsedBase.protocol !== "https:" || !ALLOWED_HOSTS.has(parsedBase.hostname) || parsedBase.pathname !== "/") {
  throw new Error("BYBIT_API_BASE must be an approved HTTPS Bybit API host.");
}

const SPACING = 250;
const UA = "GM-Crypto-Arbitrage-AI/0.2 (+public Spot market data only)";
const INSTRUMENT_TTL = 30 * 60 * 1000;

type BybitEnvelope<T> = {
  retCode: number;
  retMsg: string;
  result: T;
};

type Instrument = {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  status: string;
};

type InstrumentIndex = {
  pairs: string[];
  symbolByPair: Map<string, string>;
};

let instrumentCache: { ts: number; index: InstrumentIndex } | null = null;

async function bybitGet<T>(path: string): Promise<BybitEnvelope<T>> {
  return throttled("bybit", SPACING, async () => {
    const res = await fetch(`${BASE}/v5/market/${path}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`Bybit HTTP ${res.status} su ${path}`);
    const json = (await res.json()) as BybitEnvelope<T>;
    if (json.retCode !== 0) throw new Error(`Bybit API ${json.retCode}: ${json.retMsg}`);
    return json;
  });
}

async function instruments(): Promise<InstrumentIndex> {
  if (instrumentCache && Date.now() - instrumentCache.ts < INSTRUMENT_TTL) return instrumentCache.index;

  // Spot instruments are returned in one response; Bybit documents no cursor pagination for Spot.
  const response = await bybitGet<{ list: Instrument[] }>("instruments-info?category=spot");
  const symbolByPair = new Map<string, string>();
  for (const item of response.result.list ?? []) {
    if (item.status !== "Trading") continue;
    if (!(ASSETS as readonly string[]).includes(item.baseCoin)) continue;
    if (!(QUOTES as readonly string[]).includes(item.quoteCoin)) continue;
    symbolByPair.set(`${item.baseCoin}/${item.quoteCoin}`, item.symbol);
  }
  const index = { pairs: [...symbolByPair.keys()], symbolByPair };
  instrumentCache = { ts: Date.now(), index };
  return index;
}

type BybitTicker = {
  symbol: string;
  bid1Price: string;
  ask1Price: string;
  lastPrice: string;
};

export const bybit: VenueAdapter = {
  id: "bybit",
  displayName: "Bybit Spot",
  minSpacingMs: SPACING,
  docs: "https://bybit-exchange.github.io/docs/v5/market",

  async discoverPairs() {
    return (await instruments()).pairs;
  },

  async tickers(pairs: string[]) {
    const index = await instruments();
    const wanted = new Set(pairs.filter((pair) => index.symbolByPair.has(pair)));
    if (!wanted.size) return new Map();

    const response = await bybitGet<{ list: BybitTicker[] }>("tickers?category=spot");
    const pairBySymbol = new Map(
      [...index.symbolByPair.entries()].map(([pair, symbol]) => [symbol, pair]),
    );
    const receivedAt = Date.now();
    const out = new Map<string, Ticker>();

    for (const item of response.result.list ?? []) {
      const pair = pairBySymbol.get(item.symbol);
      if (!pair || !wanted.has(pair)) continue;
      const bid = Number(item.bid1Price);
      const ask = Number(item.ask1Price);
      const last = Number(item.lastPrice);
      if (!(bid > 0) || !(ask > 0)) continue;
      out.set(pair, {
        venue: "bybit",
        pair,
        bid,
        ask,
        last: last > 0 ? last : (bid + ask) / 2,
        ts: receivedAt,
      });
    }
    return out;
  },

  async book(pair: string, depth = 25) {
    const index = await instruments();
    const symbol = index.symbolByPair.get(pair);
    if (!symbol) throw new Error(`Bybit: coppia ${pair} non disponibile`);

    const limit = Math.max(1, Math.min(1000, Math.floor(depth)));
    const response = await bybitGet<{
      s: string;
      b: [string, string][];
      a: [string, string][];
      ts: number;
    }>(`orderbook?category=spot&symbol=${encodeURIComponent(symbol)}&limit=${limit}`);

    const receivedAt = Date.now();
    const exchangeTs = Number(response.result.ts);
    if (!Number.isFinite(exchangeTs) || exchangeTs <= 0) {
      throw new Error("Bybit: timestamp del book mancante o non valido");
    }
    if (exchangeTs > receivedAt + 5000 || receivedAt - exchangeTs > 30_000) {
      throw new Error("Bybit: snapshot order book troppo vecchio o con timestamp anomalo");
    }

    const book: Book = {
      venue: "bybit",
      pair,
      asks: toLevels(response.result.a, "asks").slice(0, limit),
      bids: toLevels(response.result.b, "bids").slice(0, limit),
      // The engine uses local receive time consistently across venues.
      ts: receivedAt,
    };
    if (!book.asks.length || !book.bids.length) throw new Error(`Bybit: book incompleto per ${pair}`);
    return book;
  },
};
