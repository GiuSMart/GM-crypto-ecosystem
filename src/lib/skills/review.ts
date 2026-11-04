import type { ReviewState, SkillReviewRecord } from "./types";

export class SkillReviewError extends Error {}

/**
 * Allowed lifecycle transitions from docs/SKILLS_GOVERNANCE.md.
 * Nothing reaches `installed` without passing `approved`, and `approved` is only
 * reachable after an audit review: installation can never be the first step.
 */
const TRANSITIONS: Record<ReviewState, readonly ReviewState[]> = {
  discovered: ["metadata_checked", "rejected", "quarantined"],
  metadata_checked: ["source_review", "rejected", "quarantined"],
  source_review: ["audit_review", "rejected", "quarantined"],
  audit_review: ["approved", "rejected", "quarantined"],
  approved: ["installed", "stale", "revoked"],
  installed: ["monitored", "stale", "revoked"],
  monitored: ["stale", "revoked"],
  stale: ["source_review", "rejected", "revoked"],
  rejected: ["revoked"],
  quarantined: ["revoked"],
  revoked: [],
};

export function openReview(input: {
  id: string;
  source: string;
  slug: string;
  sourceUrl: string;
  contentHash: string;
  license?: string | null;
}): SkillReviewRecord {
  if (!input.id || !input.source || !input.slug || !input.sourceUrl) {
    throw new SkillReviewError("id, source, slug e sourceUrl sono obbligatori");
  }
  if (!input.sourceUrl.startsWith("https://")) throw new SkillReviewError("sourceUrl deve essere https");
  if (!/^sha256:[0-9a-f]{64}$/.test(input.contentHash)) {
    throw new SkillReviewError("contentHash deve essere un digest sha256 prodotto da skillContentHash()");
  }
  return {
    id: input.id,
    source: input.source,
    slug: input.slug,
    sourceUrl: input.sourceUrl,
    license: input.license ?? null,
    contentHash: input.contentHash,
    state: "discovered",
    reviewer: null,
    decidedAt: null,
    notes: [],
  };
}

export function canTransition(from: ReviewState, to: ReviewState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function advanceReview(
  record: SkillReviewRecord,
  next: ReviewState,
  detail: { reviewer?: string; note?: string; now?: string } = {},
): SkillReviewRecord {
  if (!canTransition(record.state, next)) {
    throw new SkillReviewError(`transizione non ammessa: ${record.state} -> ${next}`);
  }
  const decided = next === "approved" || next === "rejected" || next === "quarantined" || next === "revoked";
  return {
    ...record,
    state: next,
    reviewer: detail.reviewer ?? record.reviewer,
    decidedAt: decided ? (detail.now ?? new Date().toISOString()) : record.decidedAt,
    notes: detail.note ? [...record.notes, detail.note] : record.notes,
  };
}

/**
 * Re-check a record against the current snapshot hash.
 *
 * A changed hash invalidates a positive review: anything approved, installed or
 * monitored becomes `stale` and must go back through `source_review`. Records
 * that never passed approval keep their state and only gain an explanatory note.
 */
export function reviewAfterHashCheck(
  record: SkillReviewRecord,
  currentHash: string,
  now: string = new Date().toISOString(),
): SkillReviewRecord {
  if (record.contentHash === currentHash) return record;
  const note = `snapshot cambiato (${record.contentHash} -> ${currentHash}) il ${now}`;
  const wasTrusted = record.state === "approved" || record.state === "installed" || record.state === "monitored";
  return {
    ...record,
    state: wasTrusted ? "stale" : record.state,
    notes: [...record.notes, note],
  };
}

/** Records that can be shown to the owner as ready for an installation decision. */
export function awaitingOwnerApproval(records: readonly SkillReviewRecord[]): SkillReviewRecord[] {
  return records.filter((r) => r.state === "approved");
}
