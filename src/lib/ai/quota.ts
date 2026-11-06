/**
 * In-process quota accounting for the FREE_ONLY gateway.
 *
 * A route is disabled for the rest of its reset window when the provider reports
 * quota exhaustion, a billing prompt, or a rate limit. There is no distributed
 * lock: like `src/lib/rate-limit.ts`, this is per process and must not be relied
 * on across instances.
 */
import type { FailureCode, ProviderRecord } from "./types";

export const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The gateway depends on this port, not on a concrete ledger, so the same code
 * runs against the in-memory ledger in tests and the SQLite ledger in production.
 */
export interface QuotaPort {
  remaining(provider: ProviderRecord): number;
  used(provider: ProviderRecord): number;
  blockedBy(provider: ProviderRecord): FailureCode | null;
  consume(provider: ProviderRecord): boolean;
  disable(provider: ProviderRecord, code: FailureCode, ms?: number): void;
  /**
   * Claim one slot in a shared rolling window keyed by the caller (for example
   * requests per minute). The SQLite ledger makes this atomic across processes;
   * the in-memory ledger is per process and is only a first line of defence.
   * Optional so a minimal test double can omit it (treated as "no shared limit").
   */
  claimWindow?(key: string, limit: number, windowMs: number): boolean;
}

type Entry = { count: number; windowStart: number };
type Disabled = { until: number; code: FailureCode };

export class QuotaLedger implements QuotaPort {
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly entries = new Map<string, Entry>();
  private readonly disabled = new Map<string, Disabled>();
  private readonly windows = new Map<string, { windowStart: number; used: number; limit: number }>();

  constructor(options: { now?: () => number; windowMs?: number } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.windowMs = options.windowMs ?? DAILY_WINDOW_MS;
  }

  static key(provider: Pick<ProviderRecord, "providerId" | "modelId">): string {
    return `${provider.providerId}:${provider.modelId}`;
  }

  private entry(provider: ProviderRecord): Entry {
    const key = QuotaLedger.key(provider);
    const current = this.now();
    const existing = this.entries.get(key);
    if (!existing || current - existing.windowStart >= this.windowMs) {
      const fresh: Entry = { count: 0, windowStart: current };
      this.entries.set(key, fresh);
      return fresh;
    }
    return existing;
  }

  /** Requests still available in the current window. */
  remaining(provider: ProviderRecord): number {
    return Math.max(0, provider.limits.requestsPerDay - this.entry(provider).count);
  }

  /** Requests already spent in the current window. */
  used(provider: ProviderRecord): number {
    return this.entry(provider).count;
  }

  /** Code that disabled this route, or null when it is usable. */
  blockedBy(provider: ProviderRecord): FailureCode | null {
    const key = QuotaLedger.key(provider);
    const state = this.disabled.get(key);
    if (!state) return null;
    if (this.now() >= state.until) {
      this.disabled.delete(key);
      return null;
    }
    return state.code;
  }

  /** Consume one request; false when the window budget is exhausted. */
  consume(provider: ProviderRecord): boolean {
    const entry = this.entry(provider);
    if (entry.count >= provider.limits.requestsPerDay) return false;
    entry.count += 1;
    return true;
  }

  /** Disable a route for the rest of its reset window (or a shorter hint). */
  disable(provider: ProviderRecord, code: FailureCode, ms?: number): void {
    const duration = Math.max(1, Math.min(ms ?? this.windowMs, this.windowMs));
    this.disabled.set(QuotaLedger.key(provider), { until: this.now() + duration, code });
  }

  claimWindow(key: string, limit: number, windowMs: number): boolean {
    const safeLimit = Math.floor(limit);
    if (!Number.isFinite(safeLimit) || safeLimit <= 0) return false;
    const safeWindow = Math.max(1, Math.floor(windowMs));
    const current = this.now();
    const existing = this.windows.get(key);
    const expired = !existing || current - existing.windowStart >= safeWindow;
    const windowStart = expired ? current : existing.windowStart;
    const used = expired ? 0 : existing.used;
    // The window's first claim fixes its budget: a later caller cannot widen it.
    const effectiveLimit = expired || !existing ? safeLimit : existing.limit;
    if (used >= effectiveLimit) return false;
    this.windows.set(key, { windowStart, used: used + 1, limit: effectiveLimit });
    return true;
  }

  reset(): void {
    this.entries.clear();
    this.disabled.clear();
    this.windows.clear();
  }
}
