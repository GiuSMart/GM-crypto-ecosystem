import assert from "node:assert/strict";
import test from "node:test";
import { FREE_ONLY, TASK_LIMITS, clampTaskLimits, isZeroCostProvider, taskPolicyViolations } from "../src/lib/ai/policy";
import {
  dataClassBlocker,
  eligibilityBlockers,
  hasFreshEvidence,
  selectCandidates,
  validateProviderRecord,
} from "../src/lib/ai/registry";
import { defaultRegistry, providerById } from "../src/lib/ai/providers/fixtures";
import type { TaskRequest } from "../src/lib/ai/types";

const task = (over: Partial<TaskRequest> = {}): TaskRequest => ({
  taskId: "tsk_policy",
  objective: "verifica della policy",
  dataClass: "PUBLIC",
  ...over,
});

test("policy: FREE_ONLY is a hard EUR 0 gate with no paid fallback", () => {
  assert.equal(FREE_ONLY.mode, "FREE_ONLY");
  assert.equal(FREE_ONLY.budgetEur, 0);
  assert.equal(FREE_ONLY.allowPaid, false);
  assert.equal(FREE_ONLY.allowPaidFallback, false);
  assert.equal(FREE_ONLY.allowCardActivation, false);
  assert.equal(FREE_ONLY.allowTrialConversion, false);
});

test("policy: only zero-cost records without card or silent upgrade count as free", () => {
  const base = providerById(defaultRegistry(), "openrouter");
  assert.equal(isZeroCostProvider(base), true);
  assert.equal(isZeroCostProvider({ ...base, billing: "FREE_CARD_REQUIRED" }), false);
  assert.equal(isZeroCostProvider({ ...base, billing: "UNKNOWN" }), false);
  assert.equal(isZeroCostProvider({ ...base, billing: "PAID" }), false);
  assert.equal(isZeroCostProvider({ ...base, costPerRequestEur: 0.001 }), false);
  assert.equal(isZeroCostProvider({ ...base, monthlyFixedCostEur: 9 }), false);
  assert.equal(isZeroCostProvider({ ...base, requiresPaymentCard: true }), false);
  assert.equal(isZeroCostProvider({ ...base, automaticPaidUpgrade: true }), false);
});

test("policy: a positive budget or SECRET data is rejected before selection", () => {
  assert.deepEqual(taskPolicyViolations(task()), []);
  assert.ok(taskPolicyViolations(task({ requestedBudgetEur: 0.01 })).join(" ").includes("FREE_ONLY"));
  assert.ok(taskPolicyViolations(task({ requestedBudgetEur: -1 })).length === 0, "un budget negativo non è una spesa");
  assert.ok(taskPolicyViolations(task({ dataClass: "SECRET" })).join(" ").includes("SECRET"));
});

test("policy: caller limits are clamped to the task ceiling", () => {
  const clamped = clampTaskLimits(task({ maxRequests: 999, timeoutMs: 10_000_000 }));
  assert.equal(clamped.maxRequests, TASK_LIMITS.maxRequests);
  assert.equal(clamped.timeoutMs, TASK_LIMITS.timeoutMs);
  assert.equal(clampTaskLimits(task({ maxRequests: 0 })).maxRequests, 1);
});

test("registry: only APPROVED_FREE free models become candidates, local first", () => {
  const { candidates, skipped } = selectCandidates(defaultRegistry(), task());
  assert.deepEqual(candidates.map((provider) => provider.providerId), ["ollama", "openrouter", "openrouter-backup"]);

  const rejected = skipped.map((item) => item.providerId).sort();
  assert.deepEqual(rejected, ["gemini", "huggingface", "paid-frontier"]);
  assert.ok(skipped.every((item) => item.code === "MODEL_NOT_APPROVED"));
});

test("registry: a paid record with contradictory metadata is never eligible", () => {
  const paid = providerById(defaultRegistry(), "paid-frontier");
  assert.equal(paid.state, "APPROVED_FREE");
  assert.ok(validateProviderRecord(paid).length > 0, "il record pagato deve fallire la validazione");
  assert.deepEqual(selectCandidates([paid], task()).candidates, []);
});

test("registry: unknown billing blocks the provider instead of assuming free", () => {
  const hosted = providerById(defaultRegistry(), "openrouter");
  const unknown = { ...hosted, billing: "UNKNOWN" as const };
  assert.ok(validateProviderRecord(unknown).join(" ").includes("sconosciuto"));
  assert.ok(eligibilityBlockers(unknown, task()).includes("MODEL_NOT_APPROVED"));
  assert.deepEqual(selectCandidates([unknown], task()).candidates, []);
});

test("registry: stale or malformed pricing evidence fails closed", () => {
  const hosted = providerById(defaultRegistry(), "openrouter");
  const stale = { ...hosted, pricingCheckedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString() };
  assert.equal(hasFreshEvidence(stale), false);
  assert.ok(validateProviderRecord(stale).join(" ").includes("REVIEW_REQUIRED"));
  assert.ok(eligibilityBlockers(stale, task()).includes("MODEL_NOT_APPROVED"));
  assert.deepEqual(selectCandidates([stale], task()).candidates, []);

  const malformed = { ...hosted, pricingCheckedAt: "non-una-data" };
  assert.equal(hasFreshEvidence(malformed), false);
});

test("registry: evidence must come from an official https page", () => {
  const hosted = providerById(defaultRegistry(), "openrouter");
  const insecure = { ...hosted, officialPricingUrl: "http://openrouter.ai/pricing" };
  assert.ok(validateProviderRecord(insecure).join(" ").includes("https"));
});

test("registry: data classification limits where a task may run", () => {
  const registry = defaultRegistry();
  const hosted = providerById(registry, "openrouter");
  const local = providerById(registry, "ollama");

  assert.equal(dataClassBlocker(local, "CONFIDENTIAL"), null);
  assert.equal(dataClassBlocker(hosted, "CONFIDENTIAL"), "PRIVACY_BLOCKED");
  assert.equal(dataClassBlocker(hosted, "SECRET"), "PRIVACY_BLOCKED");
  assert.equal(dataClassBlocker(hosted, "INTERNAL"), null, "openrouter ha una revisione privacy esplicita");
  assert.equal(dataClassBlocker({ ...hosted, internalDataApproved: false }, "INTERNAL"), "PRIVACY_BLOCKED");

  const confidential = selectCandidates(registry, task({ dataClass: "CONFIDENTIAL" })).candidates;
  assert.deepEqual(confidential.map((provider) => provider.providerId), ["ollama"]);

  assert.deepEqual(selectCandidates(registry, task({ dataClass: "SECRET" })).candidates, []);
});

test("registry: a failing health check removes the provider from service", () => {
  const hosted = providerById(defaultRegistry(), "openrouter");
  assert.ok(eligibilityBlockers({ ...hosted, health: "failing" }, task()).includes("PROVIDER_UNAVAILABLE"));
});

test("registry: an allowlist can only narrow eligibility, never widen it", () => {
  const registry = defaultRegistry();
  const narrowed = selectCandidates(registry, task({ providerAllowlist: ["openrouter"] })).candidates;
  assert.deepEqual(narrowed.map((provider) => provider.providerId), ["openrouter"]);

  const paid = providerById(registry, "paid-frontier");
  assert.deepEqual(selectCandidates(registry, task({ providerAllowlist: ["paid-frontier"] })).candidates, []);
  assert.notEqual(paid.state, "SUSPENDED");
});
