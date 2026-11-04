/**
 * Provider eligibility registry: validation plus task-time gating.
 *
 * Nothing here talks to a provider. The registry decides — from evidence stored
 * on the record — whether a model may ever receive a task.
 */
import { EVIDENCE_MAX_AGE_MS, isZeroCostProvider } from "./policy";
import type { DataClassification, FailureCode, ProviderRecord, TaskRequest } from "./types";

/**
 * Validate the evidence a record must carry before it can be approved.
 * An empty array means the record is structurally usable; it does NOT mean the
 * provider is eligible for a task.
 */
export function validateProviderRecord(provider: ProviderRecord, now = Date.now()): string[] {
  const issues: string[] = [];

  if (!provider.providerId.trim()) issues.push("providerId mancante");
  if (!provider.modelId.trim()) issues.push("modelId mancante");
  if (!provider.version.trim()) issues.push("versione del modello mancante");

  if (!/^https:\/\//i.test(provider.officialPricingUrl)) {
    issues.push("officialPricingUrl deve essere un URL https della pagina ufficiale");
  }
  const checkedAt = Date.parse(provider.pricingCheckedAt);
  if (!Number.isFinite(checkedAt)) {
    issues.push("pricingCheckedAt non è una data valida");
  } else if (now - checkedAt > EVIDENCE_MAX_AGE_MS) {
    issues.push("evidenza di prezzo scaduta: lo stato deve tornare REVIEW_REQUIRED");
  }

  if (!Number.isInteger(provider.limits.requestsPerDay) || provider.limits.requestsPerDay <= 0) {
    issues.push("limite di richieste per finestra non valido");
  }
  if (!(provider.capabilities.contextTokens > 0)) {
    issues.push("contextTokens non valido");
  }
  if (provider.billing === "UNKNOWN") {
    issues.push("stato di fatturazione sconosciuto: il provider non può essere APPROVED_FREE");
  }
  if (provider.monthlyFixedCostEur > 0 || provider.costPerRequestEur > 0) {
    issues.push("il provider ha un costo monetario e non è ammesso in modalità FREE_ONLY");
  }
  if (provider.state === "APPROVED_FREE" && !isZeroCostProvider(provider)) {
    issues.push("APPROVED_FREE richiede billing FREE_NO_CARD senza carta e senza upgrade automatico");
  }
  return issues;
}

/** True when the approval evidence is still within the freshness window. */
export function hasFreshEvidence(provider: ProviderRecord, now = Date.now()): boolean {
  const checkedAt = Date.parse(provider.pricingCheckedAt);
  if (!Number.isFinite(checkedAt)) return false;
  return now - checkedAt <= EVIDENCE_MAX_AGE_MS;
}

/**
 * Data-class rules from the specification:
 * - SECRET never leaves the process (it is rejected before selection);
 * - CONFIDENTIAL only on a local model;
 * - INTERNAL only locally or after an explicit privacy review.
 */
export function dataClassBlocker(provider: ProviderRecord, dataClass: DataClassification): FailureCode | null {
  if (dataClass === "SECRET") return "PRIVACY_BLOCKED";
  if (dataClass === "CONFIDENTIAL") return provider.localModel ? null : "PRIVACY_BLOCKED";
  if (dataClass === "INTERNAL") {
    return provider.localModel || provider.internalDataApproved ? null : "PRIVACY_BLOCKED";
  }
  return null;
}

/**
 * Every reason this record cannot take the task. Empty means eligible.
 * Fails closed: unknown billing, stale evidence or a failing health check all
 * produce a blocker.
 */
export function eligibilityBlockers(provider: ProviderRecord, task: TaskRequest, now = Date.now()): FailureCode[] {
  const blockers = new Set<FailureCode>();

  if (provider.state !== "APPROVED_FREE") blockers.add("MODEL_NOT_APPROVED");
  if (!isZeroCostProvider(provider)) blockers.add("MODEL_NOT_APPROVED");
  if (!hasFreshEvidence(provider, now)) blockers.add("MODEL_NOT_APPROVED");
  if (provider.health === "failing") blockers.add("PROVIDER_UNAVAILABLE");

  const privacy = dataClassBlocker(provider, task.dataClass);
  if (privacy) blockers.add(privacy);

  if (task.providerAllowlist && !task.providerAllowlist.includes(provider.providerId)) {
    blockers.add("MODEL_NOT_APPROVED");
  }
  return [...blockers];
}

export type SkippedProvider = { providerId: string; modelId: string; code: FailureCode };

/**
 * Eligible providers for a task, best first. Local models come first because
 * they cost nothing and never leave the host; the rest are ordered by id so the
 * selection is deterministic and reproducible in tests.
 */
export function selectCandidates(
  registry: readonly ProviderRecord[],
  task: TaskRequest,
  now = Date.now(),
): { candidates: ProviderRecord[]; skipped: SkippedProvider[] } {
  const candidates: ProviderRecord[] = [];
  const skipped: SkippedProvider[] = [];

  for (const provider of registry) {
    const blockers = eligibilityBlockers(provider, task, now);
    if (blockers.length === 0) {
      candidates.push(provider);
      continue;
    }
    skipped.push({ providerId: provider.providerId, modelId: provider.modelId, code: blockers[0] ?? "MODEL_NOT_APPROVED" });
  }

  candidates.sort((a, b) => {
    if (a.localModel !== b.localModel) return a.localModel ? -1 : 1;
    return a.providerId.localeCompare(b.providerId);
  });

  return { candidates, skipped };
}
