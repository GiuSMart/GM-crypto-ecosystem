import { ASSETS, QUOTES } from "../config";
import { throttled } from "../rate-limit";
import type { Book } from "../engine/arbitrage";
import { toLevels, type Ticker, type VenueAdapter } from "./types";

/**
 * OKX EEA Spot public market data.
 *
 * EU-registered OKX users must use the EEA API domain. This adapter deliberately
 * uses public endpoints only: no API key, account access, order placement or
 * withdrawal capability is implemented here.
 */
const BASE = "https://eea.okx.com";
const UA = "GM-Crypto-Arbitrage-AI/0.3 (+public Spot market data only)";
const SPACING = 150;
const INSTRUMENT_TTL = 30 * 60 * 1000;

type OkxEnvelope<T> = {
  code: string;
  msg: string;
  data: T;
};

type Instrument = {
  instId: string;
  baseCcy: string;
  quoteCcy: string;
  state: string;
};

type InstrumentIndex = {
  pairs: string[];
  instIdByPair: Map<string, string>;
  pairByInstId: Map<string, string>;
};

let instrumentCache: { ts: number; index: InstrumentIndex } | null = null;

async function okxGet<T>(path: string): Promise<OkxEnvelope<T>> {
  return throttled("okx", SPACING, async () => {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`OKX HTTP ${res.status} su ${path}`);
    const json = (await res.json()) as OkxEnvelope<T>;
    if (json.code !== "0") throw new Error(`OKX API ${json.code}: ${json.msg}`);
    if (!Array.isArray(json.data)) throw new Error("OKX: risposta dati non valida");
    return json;
  });
}

async function instruments(): Promise<InstrumentIndex> {
  if (instrumentCache && Date.now() - instrumentCache.ts < INSTRUMENT_TTL) {
    return instrumentCache.index;
  }

  const response = await okxGet<Instrument[]>("/api/v5/public/instruments?instType=SPOT");
  const instIdByPair = new Map<string, string>();
  const pairByInstId = new Map<string, string>();

  for (const item of response.data) {
    if (item.state !== "live") continue;
    if (!(ASSETS as readonly string[]).includes(item.baseCcy)) continue;
    if (!(QUOTES as readonly string[]).includes(item.quoteCcy)) continue;
    const pair = `${item.baseCcy}/${item.quoteCcy}`;
    instIdByPair.set(pair, item.instId);
    pairByInstId.set(item.instId, pair);
  }

  const index = {
    pairs: [...instIdByPair.keys()],
    instIdByPair,
    pairByInstId,
  };
  instrumentCache = { ts: Date.now(), index };
  return index;
}

type OkxTicker = {
  instId: string;
  bidPx: string;
  askPx: string;
  last: string;
};

export const okx: VenueAdapter = {
  id: "okx",
  displayName: "OKX Spot",
  minSpacingMs: SPACING,
  docs: "https://my.okx.com/docs-v5/en/",

  async discoverPairs() {
    return (await instruments()).pairs;
  },

  async tickers(pairs: string[]) {
    const index = await instruments();
    const wanted = new Set(pairs.filter((pair) => index.instIdByPair.has(pair)));
    if (!wanted.size) return new Map();

    const response = await okxGet<OkxTicker[]>("/api/v5/market/tickers?instType=SPOT");
    const receivedAt = Date.now();
    const out = new Map<string, Ticker>();

    for (const item of response.data) {
      const pair = index.pairByInstId.get(item.instId);
      if (!pair || !wanted.has(pair)) continue;
      const bid = Number(item.bidPx);
      const ask = Number(item.askPx);
      const last = Number(item.last);
      if (!(bid > 0) || !(ask > 0)) continue;
      out.set(pair, {
        venue: "okx",
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
    const instId = index.instIdByPair.get(pair);
    if (!instId) throw new Error(`OKX: coppia ${pair} non disponibile`);

    const limit = Math.max(1, Math.min(400, Math.floor(depth)));
    const response = await okxGet<{
      asks: [string, string, ...string[]][];
      bids: [string, string, ...string[]][];
      ts: string;
    }>(`/api/v5/market/books?instId=${encodeURIComponent(instId)}&sz=${limit}`);

    const snapshot = response.data[0];
    if (!snapshot) throw new Error(`OKX: order book vuoto per ${pair}`);

    const receivedAt = Date.now();
    const exchangeTs = Number(snapshot.ts);
    if (!Number.isFinite(exchangeTs) || exchangeTs <= 0) {
      throw new Error("OKX: timestamp del book mancante o non valido");
    }
    if (exchangeTs > receivedAt + 5000 || receivedAt - exchangeTs > 30_000) {
      throw new Error("OKX: snapshot order book troppo vecchio o con timestamp anomalo");
    }

    const book: Book = {
      venue: "okx",
      pair,
      asks: toLevels(snapshot.asks, "asks").slice(0, limit),
      bids: toLevels(snapshot.bids, "bids").slice(0, limit),
      // Use local receive time consistently across venue adapters.
      ts: receivedAt,
    };
    if (!book.asks.length || !book.bids.length) {
      throw new Error(`OKX: book incompleto per ${pair}`);
    }
    return book;
  },
};
