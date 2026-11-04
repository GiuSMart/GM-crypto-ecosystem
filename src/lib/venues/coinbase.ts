import { ASSETS, QUOTES } from "../config";
import { throttled } from "../rate-limit";
import type { Book } from "../engine/arbitrage";
import { toLevels, type Ticker, type VenueAdapter } from "./types";
import { assertAllowedVenueBase } from "./hosts";

const BASE = assertAllowedVenueBase("https://api.exchange.coinbase.com").origin;
const UA = "GM-Crypto-Arbitrage-AI/0.1 (+research prototype; public market data only)";

/** Public REST: 10 req/s per IP with bursts to 15 (docs.cdp.coinbase.com). 120ms spacing is safe. */
const SPACING = 120;

async function cbGet<T>(path: string): Promise<T> {
  return throttled("coinbase", SPACING, async () => {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      // Refuse redirects: a 3xx could move a "public Coinbase" call to another host.
      redirect: "error",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`Coinbase HTTP ${res.status} su ${path}`);
    return (await res.json()) as T;
  });
}

type Product = { id: string; base_currency: string; quote_currency: string; status: string; trading_disabled?: boolean };

let productCache: { ts: number; pairs: string[] } | null = null;
const PRODUCT_TTL = 30 * 60 * 1000;

async function products(): Promise<string[]> {
  if (productCache && Date.now() - productCache.ts < PRODUCT_TTL) return productCache.pairs;
  const list = await cbGet<Product[]>("/products");
  const pairs = list
    .filter(
      (p) =>
        p.status === "online" &&
        !p.trading_disabled &&
        (ASSETS as readonly string[]).includes(p.base_currency) &&
        (QUOTES as readonly string[]).includes(p.quote_currency),
    )
    .map((p) => `${p.base_currency}/${p.quote_currency}`);
  productCache = { ts: Date.now(), pairs };
  return pairs;
}

const productId = (pair: string) => pair.replace("/", "-");

export const coinbase: VenueAdapter = {
  id: "coinbase",
  displayName: "Coinbase Advanced",
  minSpacingMs: SPACING,
  docs: "https://docs.cdp.coinbase.com/exchange/rest-api/requests",

  async discoverPairs() {
    return products();
  },

  async tickers(pairs: string[]) {
    const available = new Set(await products());
    const wanted = pairs.filter((p) => available.has(p));
    const now = Date.now();
    const out = new Map<string, Ticker>();
    const results = await Promise.allSettled(
      wanted.map(async (pair) => {
        const t = await cbGet<{ bid: string; ask: string; price: string }>(`/products/${productId(pair)}/ticker`);
        return { pair, bid: Number(t.bid), ask: Number(t.ask), last: Number(t.price) };
      }),
    );
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const { pair, bid, ask, last } = r.value;
      if (!(bid > 0) || !(ask > 0)) continue;
      out.set(pair, { venue: "coinbase", pair, bid, ask, last: last || (bid + ask) / 2, ts: now });
    }
    return out;
  },

  async book(pair: string, depth = 25) {
    const raw = await cbGet<{ asks: [string, string][]; bids: [string, string][] }>(
      `/products/${productId(pair)}/book?level=2`,
    );
    const book: Book = {
      venue: "coinbase",
      pair,
      asks: toLevels(raw.asks, "asks").slice(0, depth),
      bids: toLevels(raw.bids, "bids").slice(0, depth),
      ts: Date.now(),
    };
    if (!book.asks.length || !book.bids.length) throw new Error(`Coinbase: book incompleto per ${pair}`);
    return book;
  },
};
