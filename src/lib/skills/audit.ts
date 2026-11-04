import type { AuditDecision, AuditProviderResult, AuditRiskLevel, AuditStatus, AuditVerdict } from "./types";

/**
 * Normalise one raw provider audit.
 *
 * Unknown values always become the worst case (`UNKNOWN`), never an optimistic
 * default: a provider we cannot classify must not look like a pass.
 */
export function normalizeAudit(raw: {
  provider?: unknown;
  slug?: unknown;
  status?: unknown;
  riskLevel?: unknown;
  summary?: unknown;
  auditedAt?: unknown;
}): AuditProviderResult {
  const provider = typeof raw.provider === "string" && raw.provider.trim() ? raw.provider.trim() : "unknown";
  const status = normalizeStatus(raw.status);
  const riskLevel = normalizeRisk(raw.riskLevel);
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  const auditedAt = typeof raw.auditedAt === "string" && !Number.isNaN(Date.parse(raw.auditedAt)) ? raw.auditedAt : null;
  const slug = typeof raw.slug === "string" && raw.slug.trim() ? raw.slug.trim() : provider.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return { provider, slug, status, riskLevel, summary, auditedAt };
}

function normalizeStatus(value: unknown): AuditStatus {
  if (typeof value !== "string") return "unknown";
  switch (value.trim().toLowerCase()) {
    case "pass":
    case "passed":
    case "safe":
      return "pass";
    case "warn":
    case "warning":
      return "warn";
    case "fail":
    case "failed":
      return "fail";
    case "pending":
      return "pending";
    default:
      return "unknown";
  }
}

function normalizeRisk(value: unknown): AuditRiskLevel {
  if (typeof value !== "string") return "UNKNOWN";
  switch (value.trim().toUpperCase()) {
    case "NONE":
    case "SAFE":
      return "NONE";
    case "LOW":
      return "LOW";
    case "MEDIUM":
      return "MEDIUM";
    case "HIGH":
      return "HIGH";
    case "CRITICAL":
      return "CRITICAL";
    default:
      return "UNKNOWN";
  }
}

const DECISION_RANK: Record<AuditDecision, number> = {
  eligible_for_source_review: 0,
  hold: 1,
  manual_review: 2,
  quarantine: 3,
  reject: 4,
};

/**
 * Apply the audit matrix from docs/SKILLS_GOVERNANCE.md.
 *
 * Ordering matters and is deliberately conservative:
 *   1. any `fail` or HIGH/CRITICAL risk  -> reject
 *   2. any `warn` or MEDIUM risk         -> manual review
 *   3. any pending/unknown/missing audit -> hold (unknown is not a pass)
 *   4. everything passed                 -> eligible for source review only
 * A missing audit set is `hold`, never a pass.
 */
export function decideFromAudits(audits: readonly AuditProviderResult[]): AuditVerdict {
  if (audits.length === 0) {
    return { decision: "hold", reasons: ["nessuna audit disponibile: stato sconosciuto"], conservative: null };
  }

  const rejected = audits.filter((a) => a.status === "fail" || a.riskLevel === "HIGH" || a.riskLevel === "CRITICAL");
  if (rejected.length > 0) {
    return {
      decision: "reject",
      reasons: rejected.map((a) => `${a.provider}: ${describe(a)}`),
      conservative: mostSevere(rejected),
    };
  }

  const review = audits.filter((a) => a.status === "warn" || a.riskLevel === "MEDIUM");
  if (review.length > 0) {
    return {
      decision: "manual_review",
      reasons: review.map((a) => `${a.provider}: ${describe(a)}`),
      conservative: mostSevere(review),
    };
  }

  const unknown = audits.filter(
    (a) => a.status === "pending" || a.status === "unknown" || a.riskLevel === "UNKNOWN",
  );
  if (unknown.length > 0) {
    return {
      decision: "hold",
      reasons: unknown.map((a) => `${a.provider}: ${describe(a)}`),
      conservative: mostSevere(unknown),
    };
  }

  const notPassing = audits.filter((a) => a.status !== "pass");
  if (notPassing.length > 0) {
    return {
      decision: "hold",
      reasons: notPassing.map((a) => `${a.provider}: ${describe(a)}`),
      conservative: mostSevere(notPassing),
    };
  }

  return {
    decision: "eligible_for_source_review",
    reasons: audits.map((a) => `${a.provider}: ${describe(a)}`),
    conservative: null,
  };
}

/** Pick the provider whose result is the most conservative, for the review record. */
export function mostSevere(audits: readonly AuditProviderResult[]): AuditProviderResult | null {
  let best: AuditProviderResult | null = null;
  let bestScore = -1;
  for (const audit of audits) {
    const score = DECISION_RANK[decisionFor(audit)];
    if (score > bestScore) {
      best = audit;
      bestScore = score;
    }
  }
  return best;
}

function decisionFor(audit: AuditProviderResult): AuditDecision {
  if (audit.status === "fail" || audit.riskLevel === "HIGH" || audit.riskLevel === "CRITICAL") return "reject";
  if (audit.status === "warn" || audit.riskLevel === "MEDIUM") return "manual_review";
  if (audit.status === "pending" || audit.status === "unknown" || audit.riskLevel === "UNKNOWN") return "hold";
  return "eligible_for_source_review";
}

function describe(audit: AuditProviderResult): string {
  const risk = audit.riskLevel === "UNKNOWN" ? "rischio sconosciuto" : `rischio ${audit.riskLevel.toLowerCase()}`;
  return `stato ${audit.status}, ${risk}${audit.summary ? ` (${audit.summary})` : ""}`;
}

/**
 * True when every provider has a usable result. A stale or missing provider is
 * reported to the reviewer instead of being silently dropped.
 */
export function auditsComplete(audits: readonly AuditProviderResult[]): boolean {
  return audits.length > 0 && audits.every((a) => a.status !== "pending" && a.status !== "unknown");
}

/**
 * An audit is a point-in-time signal: a result older than `maxAgeDays` cannot
 * support an approval and must be refreshed or manually reviewed.
 */
export function auditIsFresh(audit: AuditProviderResult, now: number, maxAgeDays = 180): boolean {
  if (!audit.auditedAt) return false;
  const age = now - Date.parse(audit.auditedAt);
  if (!Number.isFinite(age)) return false;
  return age <= maxAgeDays * 24 * 60 * 60 * 1000;
}
