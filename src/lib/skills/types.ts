/**
 * Types for the read-only Skills Intelligence layer.
 *
 * Nothing here installs, updates or executes an external Skill: a Skill is
 * untrusted instruction content, so the only outputs are review records and
 * deterministic decisions that a human still has to approve.
 */

/** A skill as returned by the skills.sh catalogue endpoints. */
export type SkillSummary = {
  /** Stable identifier: `{source}/{slug}`. */
  id: string;
  slug: string;
  name: string;
  /** GitHub repository that publishes the skill, `owner/repo`. */
  source: string;
  installs: number;
  sourceType: string;
  installUrl: string;
  url: string;
};

export type SkillsPagination = {
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
};

export type SkillsPage = {
  data: SkillSummary[];
  pagination: SkillsPagination;
};

export type SkillFileSnapshot = {
  /** Repository-relative path, POSIX separators. */
  path: string;
  content: string;
};

export type SkillDetail = SkillSummary & {
  files: SkillFileSnapshot[];
  /** Provider-reported snapshot hash, when the API exposes one. */
  hash: string | null;
};

export type AuditStatus = "pass" | "warn" | "fail" | "pending" | "unknown";

export type AuditRiskLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";

/** One provider's result, normalised. Provider names are kept verbatim. */
export type AuditProviderResult = {
  provider: string;
  slug: string;
  status: AuditStatus;
  riskLevel: AuditRiskLevel;
  summary: string;
  /** ISO timestamp reported by the provider, or null when absent. */
  auditedAt: string | null;
};

/**
 * Conservative verdict of the governance matrix in docs/SKILLS_GOVERNANCE.md.
 * `eligible_for_source_review` is never an approval: the source still has to be read.
 */
export type AuditDecision = "reject" | "quarantine" | "manual_review" | "hold" | "eligible_for_source_review";

export type AuditVerdict = {
  decision: AuditDecision;
  reasons: string[];
  /** Provider whose result forced the decision, when one did. */
  conservative: AuditProviderResult | null;
};

/** Lifecycle from docs/SKILLS_GOVERNANCE.md. Terminal states are never exited. */
export type ReviewState =
  | "discovered"
  | "metadata_checked"
  | "source_review"
  | "audit_review"
  | "approved"
  | "installed"
  | "monitored"
  | "rejected"
  | "quarantined"
  | "stale"
  | "revoked";

export type SkillReviewRecord = {
  id: string;
  source: string;
  slug: string;
  sourceUrl: string;
  license: string | null;
  /** `sha256:` hash of the reviewed snapshot; a change invalidates the review. */
  contentHash: string;
  state: ReviewState;
  reviewer: string | null;
  decidedAt: string | null;
  notes: string[];
};
