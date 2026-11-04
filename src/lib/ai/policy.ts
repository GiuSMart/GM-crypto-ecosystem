/**
 * Central FREE_ONLY policy.
 *
 * The zero-spend rule is a hard technical gate, not a preference: every other
 * module in `src/lib/ai` reads these constants instead of accepting a budget
 * from a caller. See docs/GM_AI_COLLECTIVE_FREE_ONLY.md, section 1.
 */
import type { ProviderRecord, TaskRequest } from "./types";

export const FREE_ONLY = {
  mode: "FREE_ONLY",
  currency: "EUR",
  /** Hard monetary budget. No code path may raise this. */
  budgetEur: 0,
  allowPaid: false,
  allowPaidFallback: false,
  allowCardActivation: false,
  allowTrialConversion: false,
} as const;

/** Bounded work per task so a single request cannot drain a free quota. */
export const TASK_LIMITS = {
  maxRequests: 6,
  maxInputTokens: 32_000,
  timeoutMs: 20_000,
} as const;

/** Provider approval evidence older than this must be re-checked. */
export const EVIDENCE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * True only when the record can never cost money: no price per request, no
 * plan, no card, no silent upgrade. Anything unknown is false.
 */
export function isZeroCostProvider(provider: ProviderRecord): boolean {
  return (
    provider.billing === "FREE_NO_CARD" &&
    provider.costPerRequestEur === 0 &&
    provider.monthlyFixedCostEur === 0 &&
    !provider.requiresPaymentCard &&
    !provider.automaticPaidUpgrade
  );
}

/** Structural policy problems with a task, independent of any provider. */
export function taskPolicyViolations(task: TaskRequest): string[] {
  const violations: string[] = [];
  if (!task.taskId.trim()) violations.push("taskId mancante");
  if (!task.objective.trim()) violations.push("objective mancante");
  if (typeof task.requestedBudgetEur === "number" && task.requestedBudgetEur > FREE_ONLY.budgetEur) {
    violations.push(`budget richiesto ${task.requestedBudgetEur} EUR oltre il limite FREE_ONLY di ${FREE_ONLY.budgetEur} EUR`);
  }
  if (task.dataClass === "SECRET") {
    violations.push("i dati SECRET non possono essere inviati ad alcun provider, nemmeno locale");
  }
  return violations;
}

/** Clamp caller-supplied limits to the policy ceiling, never above it. */
export function clampTaskLimits(task: TaskRequest): { maxRequests: number; timeoutMs: number; maxInputTokens: number } {
  const requestedRequests = task.maxRequests ?? TASK_LIMITS.maxRequests;
  const requestedTimeout = task.timeoutMs ?? TASK_LIMITS.timeoutMs;
  const maxRequests = Math.min(TASK_LIMITS.maxRequests, Math.max(1, Math.floor(requestedRequests)));
  const timeoutMs = Math.min(TASK_LIMITS.timeoutMs, Math.max(1, Math.floor(requestedTimeout)));
  return { maxRequests, timeoutMs, maxInputTokens: TASK_LIMITS.maxInputTokens };
}
