import type { Book, Level } from "../engine/arbitrage";

export type Ticker = {
  venue: string;
  pair: string;
  bid: number;
  ask: number;
  last: number;
  /** Local receive timestamp (ms). */
  ts: number;
};

export type VenueAdapter = {
  id: string;
  displayName: string;
  /** Minimum spacing between outbound calls, derived from the documented public limits. */
  minSpacingMs: number;
  docs: string;
  /** Normalised pairs ("BTC/USD") for which this venue publishes a tradeable book. */
  discoverPairs(): Promise<string[]>;
  tickers(pairs: string[]): Promise<Map<string, Ticker>>;
  book(pair: string, depth?: number): Promise<Book>;
};

export const toLevels = (raw: [string, string, ...unknown[]][], side: "asks" | "bids"): Level[] => {
  const levels = raw
    .map(([p, s]) => ({ price: Number(p), size: Number(s) }))
    .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size) && l.price > 0 && l.size > 0);
  levels.sort((a, b) => (side === "asks" ? a.price - b.price : b.price - a.price));
  return levels;
};

export const pct = (from: number, to: number) => (from > 0 ? ((to - from) / from) * 100 : 0);
