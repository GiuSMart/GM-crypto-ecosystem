/**
 * Persisted quota ledger.
 *
 * Same contract as the in-memory `QuotaLedger`, but counters and route blocks
 * survive a restart and are shared by every process pointing at the same file.
 * The atomic decision lives in `AiStore.claim()`.
 */
import type { QuotaPort } from "./quota";
import type { AiStore } from "./store";
import type { FailureCode, ProviderRecord } from "./types";

export class SqliteQuotaLedger implements QuotaPort {
  constructor(private readonly store: AiStore) {}

  remaining(provider: ProviderRecord): number {
    return this.store.remaining(provider);
  }

  used(provider: ProviderRecord): number {
    return this.store.used(provider);
  }

  blockedBy(provider: ProviderRecord): FailureCode | null {
    return this.store.blockedBy(provider);
  }

  consume(provider: ProviderRecord): boolean {
    return this.store.claim(provider).ok;
  }

  disable(provider: ProviderRecord, code: FailureCode, ms?: number): void {
    this.store.disable(provider, code, ms);
  }
}
