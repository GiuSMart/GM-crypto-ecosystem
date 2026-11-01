import { coinbase } from "./coinbase";
import { kraken } from "./kraken";
import type { VenueAdapter } from "./types";

/** Venues with a public, unauthenticated order book. Extend this map to add a venue. */
export const ADAPTERS: Record<string, VenueAdapter> = {
  [kraken.id]: kraken,
  [coinbase.id]: coinbase,
};
