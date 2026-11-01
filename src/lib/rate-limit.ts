/**
 * In-process token bucket rate limiter.
 *
 * Deliberately dependency-free. It protects a single Node process; for a
 * multi-instance deployment swap the Map for Redis (see docs/ARCHITECTURE.md).
 */
type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();
const globalForLimiter = globalThis as unknown as { __gmBuckets?: Map<string, Bucket> };
const store = globalForLimiter.__gmBuckets ?? buckets;
globalForLimiter.__gmBuckets = store;

export type RateResult = { ok: boolean; remaining: number; retryAfterSec: number };

export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  const bucket = store.get(key) ?? { tokens: limit, updatedAt: now };
  const refill = ((now - bucket.updatedAt) / windowMs) * limit;
  bucket.tokens = Math.min(limit, bucket.tokens + Math.max(0, refill));
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    store.set(key, bucket);
    const needed = (1 - bucket.tokens) / (limit / windowMs);
    return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil(needed / 1000)) };
  }
  bucket.tokens -= 1;
  store.set(key, bucket);
  return { ok: true, remaining: Math.floor(bucket.tokens), retryAfterSec: 0 };
}

/** Periodic cleanup so the map cannot grow without bound. */
export function sweepRateLimiter(maxAgeMs = 60 * 60 * 1000) {
  const now = Date.now();
  for (const [key, bucket] of store) {
    if (now - bucket.updatedAt > maxAgeMs) store.delete(key);
  }
}

/* -------------------------------------------------------------------------- */
/* Outbound venue request throttle                                             */
/* -------------------------------------------------------------------------- */

/**
 * Public Kraken REST is documented at roughly 1 request/second per IP, so every
 * outbound call is serialised through a per-venue queue with a minimum spacing.
 */
const lastCall = new Map<string, number>();
const venueQueues = new Map<string, Promise<void>>();

/**
 * Serialize requests per venue, then enforce spacing between their start times.
 * A timestamp-only scheduler lets simultaneous callers receive the same slot
 * and burst together; the promise queue prevents that under concurrent scans.
 */
export async function throttled<T>(venue: string, minSpacingMs: number, fn: () => Promise<T>): Promise<T> {
  const previous = venueQueues.get(venue) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  venueQueues.set(venue, queued);

  await previous;
  try {
    const wait = Math.max(0, (lastCall.get(venue) ?? 0) + minSpacingMs - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCall.set(venue, Date.now());
    return await fn();
  } finally {
    release();
    if (venueQueues.get(venue) === queued) venueQueues.delete(venue);
  }
}
