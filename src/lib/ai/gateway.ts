/**
 * Free-only provider gateway (Stage B).
 *
 * The gateway is transport-agnostic: adapters are injected, so tests never touch
 * a network. It enforces, in order: the FREE_ONLY budget, the data
 * classification, registry eligibility, quota, and bounded attempts. A failure
 * never escalates to a paid route — it parks the task instead.
 */
import { ROUTE_LIMITS, clampTaskLimits, isZeroCostProvider, taskPolicyViolations } from "./policy";
import type { QuotaPort } from "./quota";
import { selectCandidates } from "./registry";
import type {
  AdapterRequest,
  AdapterResult,
  AuditEvent,
  AuditSink,
  FailureCode,
  GatewayAttempt,
  GatewayResult,
  ProviderAdapter,
  ProviderRecord,
  TaskRequest,
} from "./types";

import { redact } from "./redact";

/** Re-exported so audit sinks and adapters share one redaction list. */
export { redact };

export type GatewayDeps = {
  registry: readonly ProviderRecord[];
  adapters: Record<string, ProviderAdapter | undefined>;
  ledger: QuotaPort;
  audit?: AuditSink;
  now?: () => number;
};

async function callAdapter(
  adapter: ProviderAdapter,
  request: AdapterRequest,
  timeoutMs: number,
): Promise<AdapterResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<AdapterResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, code: "TIMEOUT", detail: `timeout ${timeoutMs} ms` });
    }, Math.max(1, timeoutMs));
  });

  try {
    return await Promise.race([adapter(request, controller.signal), timeout]);
  } catch (error) {
    return {
      ok: false,
      code: "INVALID_RESPONSE",
      detail: error instanceof Error ? error.message : "errore sconosciuto dell'adapter",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run one bounded task. Returns a typed result; every attempt is recorded in
 * `attempts` and, when a sink is provided, in the audit trail.
 */
export async function runTask(task: TaskRequest, prompt: string, deps: GatewayDeps): Promise<GatewayResult> {
  const now = deps.now ?? (() => Date.now());
  const attempts: GatewayAttempt[] = [];

  const emit = (event: Omit<AuditEvent, "ts" | "taskId">): void => {
    if (!deps.audit) return;
    const entry: AuditEvent = {
      ts: new Date(now()).toISOString(),
      taskId: task.taskId,
      action: event.action,
    };
    if (event.providerId) entry.providerId = event.providerId;
    if (event.modelId) entry.modelId = event.modelId;
    if (event.code) entry.code = event.code;
    if (event.detail) entry.detail = redact(event.detail).slice(0, 300);
    deps.audit(entry);
  };

  emit({ action: "task.received", detail: task.objective });

  // Stage A gate: budget, SECRET data and malformed tasks stop here.
  const violations = taskPolicyViolations(task);
  if (violations.length > 0) {
    const code: FailureCode = task.dataClass === "SECRET" ? "PRIVACY_BLOCKED" : "TASK_BUDGET_EXCEEDED";
    emit({ action: "task.failed", code, detail: violations.join("; ") });
    return { ok: false, code, attempts, queued: false };
  }

  const limits = clampTaskLimits(task);
  const { candidates, skipped } = selectCandidates(deps.registry, task, now());
  for (const item of skipped) {
    emit({ action: "provider.skipped", providerId: item.providerId, modelId: item.modelId, code: item.code });
  }

  // With no candidates at all, report the reason that actually blocked the task
  // rather than a generic refusal.
  let lastCode: FailureCode = "MODEL_NOT_APPROVED";
  if (candidates.length === 0 && skipped.length > 0) {
    lastCode = skipped.find((item) => item.code === "PRIVACY_BLOCKED")?.code ?? skipped[0].code;
  }
  let attempted = 0;

  for (const provider of candidates) {
    if (attempted >= limits.maxRequests) {
      lastCode = "TASK_BUDGET_EXCEEDED";
      break;
    }

    // Defensive re-check: no adapter may ever run for a non-zero-cost record.
    if (!isZeroCostProvider(provider)) {
      lastCode = "MODEL_NOT_APPROVED";
      emit({ action: "provider.skipped", providerId: provider.providerId, modelId: provider.modelId, code: "MODEL_NOT_APPROVED" });
      continue;
    }

    const blocked = deps.ledger.blockedBy(provider);
    if (blocked) {
      lastCode = blocked;
      emit({
        action: "provider.skipped",
        providerId: provider.providerId,
        modelId: provider.modelId,
        code: blocked,
        detail: "route disabilitata nella finestra corrente",
      });
      continue;
    }

    if (deps.ledger.remaining(provider) <= 0) {
      lastCode = "QUOTA_EXHAUSTED";
      deps.ledger.disable(provider, "QUOTA_EXHAUSTED");
      emit({ action: "provider.disabled", providerId: provider.providerId, modelId: provider.modelId, code: "QUOTA_EXHAUSTED" });
      continue;
    }

    const adapter = deps.adapters[provider.providerId];
    if (!adapter) {
      lastCode = "PROVIDER_UNAVAILABLE";
      emit({ action: "provider.skipped", providerId: provider.providerId, modelId: provider.modelId, code: "PROVIDER_UNAVAILABLE" });
      continue;
    }

    // Shared per-minute window, atomic in SQLite: a local in-process limiter
    // cannot bound several instances that share the same provider key.
    const minuteKey = `ai:minute:${provider.providerId}`;
    const minuteAllowed = deps.ledger.claimWindow
      ? deps.ledger.claimWindow(minuteKey, ROUTE_LIMITS.globalRequestsPerMinute, 60_000)
      : true;
    if (!minuteAllowed) {
      lastCode = "RATE_LIMITED";
      emit({
        action: "provider.skipped",
        providerId: provider.providerId,
        modelId: provider.modelId,
        code: "RATE_LIMITED",
        detail: "limite condiviso di richieste al minuto raggiunto: nessun invio",
      });
      continue;
    }

    if (!deps.ledger.consume(provider)) {
      lastCode = "QUOTA_EXHAUSTED";
      continue;
    }

    attempted += 1;
    emit({ action: "provider.selected", providerId: provider.providerId, modelId: provider.modelId, detail: `tentativo ${attempted}/${limits.maxRequests}` });

    const startedAt = now();
    const outcome = await callAdapter(adapter, { provider, task, prompt }, limits.timeoutMs);
    const durationMs = Math.max(0, now() - startedAt);

    const attempt: GatewayAttempt = {
      providerId: provider.providerId,
      modelId: provider.modelId,
      version: provider.version,
      outcome: outcome.ok ? "ok" : outcome.code,
      durationMs,
    };
    if (outcome.ok && outcome.usage) attempt.usage = outcome.usage;
    attempts.push(attempt);

    if (outcome.ok) {
      emit({ action: "task.succeeded", providerId: provider.providerId, modelId: provider.modelId, detail: `${durationMs} ms` });
      return {
        ok: true,
        providerId: provider.providerId,
        modelId: provider.modelId,
        version: provider.version,
        text: outcome.text,
        attempts,
      };
    }

    lastCode = outcome.code;
    emit({ action: "provider.failed", providerId: provider.providerId, modelId: provider.modelId, code: outcome.code, detail: outcome.detail });

    // Cost and quota signals close the route for the rest of the window.
    if (outcome.code === "BILLING_REQUIRED" || outcome.code === "QUOTA_EXHAUSTED") {
      deps.ledger.disable(provider, outcome.code);
      emit({ action: "provider.disabled", providerId: provider.providerId, modelId: provider.modelId, code: outcome.code });
    } else if (outcome.code === "RATE_LIMITED") {
      deps.ledger.disable(provider, "RATE_LIMITED", outcome.retryAfterMs);
      emit({ action: "provider.disabled", providerId: provider.providerId, modelId: provider.modelId, code: "RATE_LIMITED" });
    }
  }

  emit({
    action: "task.queued",
    code: lastCode,
    detail: "nessun provider gratuito approvato utilizzabile: la richiesta resta in coda, nessun fallback a pagamento",
  });
  return { ok: false, code: lastCode, attempts, queued: true };
}
