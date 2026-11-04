import assert from "node:assert/strict";
import test from "node:test";
import { decideFromAudits, normalizeAudit } from "../src/lib/skills/audit";
import { SkillSnapshotError, skillContentHash } from "../src/lib/skills/hash";
import { SkillReviewError, advanceReview, canTransition, openReview, reviewAfterHashCheck } from "../src/lib/skills/review";
import type { AuditProviderResult } from "../src/lib/skills/types";

const audit = (over: Partial<AuditProviderResult>): AuditProviderResult => ({
  provider: "Provider",
  slug: "provider",
  status: "pass",
  riskLevel: "LOW",
  summary: "",
  auditedAt: null,
  ...over,
});

const snapshot = [
  { path: "SKILL.md", content: "# Skill\n" },
  { path: "scripts/check.sh", content: "echo ok\n" },
];

/** Walk a reviewed record to `approved` without inventing a shortcut. */
function approvedRecord() {
  let record = openReview({
    id: "vercel-labs/agent-skills/web-design-guidelines",
    source: "vercel-labs/agent-skills",
    slug: "web-design-guidelines",
    sourceUrl: "https://skills.sh/vercel-labs/agent-skills/web-design-guidelines",
    contentHash: skillContentHash(snapshot),
    license: "MIT",
  });
  for (const state of ["metadata_checked", "source_review", "audit_review", "approved"] as const) {
    record = advanceReview(record, state, { reviewer: "owner" });
  }
  return record;
}

test("any failing provider rejects the skill and is reported as the conservative result", () => {
  const verdict = decideFromAudits([
    audit({ provider: "Socket", status: "pass", riskLevel: "LOW" }),
    audit({ provider: "Snyk", status: "fail", riskLevel: "HIGH" }),
  ]);
  assert.equal(verdict.decision, "reject");
  assert.equal(verdict.conservative?.provider, "Snyk");
  assert.ok(verdict.reasons.some((r) => r.includes("Snyk")));
});

test("HIGH or CRITICAL risk is rejected even when the status says pass", () => {
  assert.equal(decideFromAudits([audit({ riskLevel: "HIGH" })]).decision, "reject");
  assert.equal(decideFromAudits([audit({ riskLevel: "CRITICAL" })]).decision, "reject");
});

test("warnings and MEDIUM risk require a manual review", () => {
  assert.equal(decideFromAudits([audit({ status: "warn" })]).decision, "manual_review");
  assert.equal(decideFromAudits([audit({ riskLevel: "MEDIUM" })]).decision, "manual_review");
});

test("a missing or pending audit holds the skill instead of passing it", () => {
  assert.equal(decideFromAudits([]).decision, "hold");
  assert.equal(decideFromAudits([audit({ status: "pending" })]).decision, "hold");
  assert.equal(decideFromAudits([audit({ status: "unknown" })]).decision, "hold");
  assert.equal(decideFromAudits([audit({ riskLevel: "UNKNOWN" })]).decision, "hold");
});

test("conflicting providers use the most conservative result", () => {
  const verdict = decideFromAudits([
    audit({ provider: "Runlayer", riskLevel: "NONE" }),
    audit({ provider: "Gen Agent Trust Hub", riskLevel: "HIGH" }),
    audit({ provider: "Snyk", riskLevel: "LOW" }),
  ]);
  assert.equal(verdict.decision, "reject");
  assert.equal(verdict.conservative?.provider, "Gen Agent Trust Hub");
});

test("all passing providers only make a skill eligible for source review", () => {
  const verdict = decideFromAudits([
    audit({ provider: "Socket", riskLevel: "LOW" }),
    audit({ provider: "Snyk", riskLevel: "LOW" }),
    audit({ provider: "Runlayer", riskLevel: "NONE" }),
  ]);
  assert.equal(verdict.decision, "eligible_for_source_review");
  assert.equal(verdict.conservative, null);
});

test("provider values are normalised conservatively", () => {
  const safe = normalizeAudit({ provider: "Gen Agent Trust Hub", status: "PASS", riskLevel: "SAFE" });
  assert.equal(safe.status, "pass");
  assert.equal(safe.riskLevel, "NONE");

  const odd = normalizeAudit({ provider: "ZeroLeaks", status: "something-new", riskLevel: "moderate" });
  assert.equal(odd.status, "unknown");
  assert.equal(odd.riskLevel, "UNKNOWN");
  assert.equal(decideFromAudits([odd]).decision, "hold");

  const noDate = normalizeAudit({ provider: "X", status: "pass", auditedAt: "not-a-date" });
  assert.equal(noDate.auditedAt, null);
});

test("snapshot hash is stable across file order and changes with content", () => {
  const a = skillContentHash(snapshot);
  const b = skillContentHash([...snapshot].reverse());
  assert.equal(a, b);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(a, skillContentHash([snapshot[0], { path: "scripts/check.sh", content: "echo changed\n" }]));
});

test("snapshot hash refuses duplicates, unsafe paths and empty snapshots", () => {
  assert.throws(() => skillContentHash([]), SkillSnapshotError);
  assert.throws(() => skillContentHash([snapshot[0], snapshot[0]]), /file duplicato/);
  for (const path of ["/etc/passwd", "../outside.md", "a//b.md", "scripts/../../x.md", ""]) {
    assert.throws(() => skillContentHash([{ path, content: "x" }]), SkillSnapshotError, `path ${path} doveva essere rifiutato`);
  }
});

test("the review lifecycle cannot skip the audit stage or start at installed", () => {
  const record = approvedRecord();
  assert.equal(record.state, "approved");
  assert.equal(canTransition("discovered", "installed"), false);
  assert.equal(canTransition("audit_review", "installed"), false);
  assert.equal(canTransition("approved", "installed"), true);
  assert.throws(() => advanceReview(record, "discovered"), SkillReviewError);
  assert.throws(() => advanceReview(record, "source_review"), /non ammessa/);
});

test("a changed snapshot marks an approved skill stale", () => {
  const record = approvedRecord();
  const nextHash = skillContentHash([{ path: "SKILL.md", content: "# Skill v2\n" }]);
  const stale = reviewAfterHashCheck(record, nextHash, "2026-11-04T10:00:00.000Z");
  assert.equal(stale.state, "stale");
  assert.ok(stale.notes.some((n) => n.includes("snapshot cambiato")));
  assert.equal(reviewAfterHashCheck(record, record.contentHash).state, "approved");
});

test("records that were never approved keep their state when the snapshot changes", () => {
  const record = openReview({
    id: "owner/repo/skill",
    source: "owner/repo",
    slug: "skill",
    sourceUrl: "https://skills.sh/owner/repo/skill",
    contentHash: skillContentHash(snapshot),
  });
  const after = reviewAfterHashCheck(record, skillContentHash([{ path: "SKILL.md", content: "x" }]));
  assert.equal(after.state, "discovered");
  assert.equal(after.notes.length, 1);
});

test("review records require an https source and a real snapshot hash", () => {
  const base = {
    id: "owner/repo/skill",
    source: "owner/repo",
    slug: "skill",
    contentHash: skillContentHash(snapshot),
  };
  assert.throws(() => openReview({ ...base, sourceUrl: "http://example.com/skill" }), /https/);
  assert.throws(() => openReview({ ...base, sourceUrl: "https://example.com/skill", contentHash: "sha256:short" }), /sha256/);
});
