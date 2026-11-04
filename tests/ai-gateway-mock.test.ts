import assert from "node:assert/strict";
import test from "node:test";
import { redact, runTask } from "../src/lib/ai/gateway";
import { QuotaLedger } from "../src/lib/ai/quota";
import { defaultRegistry, mockAdapter, okText, providerById } from "../src/lib/ai/providers/fixtures";
import type { AuditEvent, ProviderRecord, TaskRequest } from "../src/lib/ai/types";

const task = (over: Partial<TaskRequest> = {}): TaskRequest => ({
  taskId: "tsk_gateway",
  objective: "prova del gateway",
  dataClass: "PUBLIC",
  ...over,
});

/** Two hosted free providers, so fallback never depends on the local model. */
const hostedFree = (): ProviderRecord[] =>
  defaultRegistry().filter((provider) => provider.providerId === "openrouter" || provider.providerId === "openrouter-backup");

test("gateway: routes to an approved free model and charges one request", async () => {
  const registry = hostedFree();
  const ledger = new QuotaLedger();
  const events: AuditEvent[] = [];
  const adapter = mockAdapter(() => okText("risposta"));

  const result = await runTask(task(), "prompt", {
    registry,
    ledger,
    adapters: { openrouter: adapter },
    audit: (event) => events.push(event),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.providerId, "openrouter");
  assert.equal(result.text, "risposta");
  assert.equal(adapter.calls.length, 1);
  assert.equal(ledger.used(providerById(registry, "openrouter")), 1);
  assert.ok(events.some((event) => event.action === "task.succeeded"));
  assert.ok(events.every((event) => event.taskId === "tsk_gateway"));
});

test("gateway: a paid record is never selected even when an adapter exists", async () => {
  const paid = mockAdapter(() => okText("pagato"));
  const free = mockAdapter(() => okText("gratuito"));

  const result = await runTask(task(), "prompt", {
    registry: defaultRegistry(),
    ledger: new QuotaLedger(),
    adapters: { "paid-frontier": paid, openrouter: free },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.providerId, "openrouter");
  assert.equal(paid.calls.length, 0, "un provider a pagamento non deve mai essere chiamato");
});

test("gateway: unknown billing status blocks the route and queues the task", async () => {
  const registry = defaultRegistry()
    .filter((provider) => provider.providerId === "openrouter")
    .map((provider) => ({ ...provider, billing: "UNKNOWN" as const }));
  const adapter = mockAdapter(() => okText("mai"));

  const result = await runTask(task(), "prompt", {
    registry,
    ledger: new QuotaLedger(),
    adapters: { openrouter: adapter },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "MODEL_NOT_APPROVED");
  assert.equal(result.queued, true);
  assert.equal(adapter.calls.length, 0);
});

test("gateway: a billing prompt disables the route and fallback stays free", async () => {
  const registry = hostedFree();
  const ledger = new QuotaLedger();
  const primary = mockAdapter(() => ({ ok: false, code: "BILLING_REQUIRED", detail: "carta richiesta" }));
  const backup = mockAdapter(() => okText("backup"));
  const deps = { registry, ledger, adapters: { openrouter: primary, "openrouter-backup": backup } };

  const first = await runTask(task(), "prompt", deps);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.providerId, "openrouter-backup");
  assert.deepEqual(first.attempts.map((attempt) => attempt.outcome), ["BILLING_REQUIRED", "ok"]);
  assert.equal(ledger.blockedBy(providerById(registry, "openrouter")), "BILLING_REQUIRED");

  const second = await runTask(task(), "prompt", deps);
  assert.equal(second.ok, true);
  assert.equal(primary.calls.length, 1, "la route che chiede fatturazione non va ritentata");
});

test("gateway: exhausted free quotas queue the task instead of escalating", async () => {
  const registry = hostedFree().map((provider) => ({
    ...provider,
    limits: { ...provider.limits, requestsPerDay: 1 },
  }));
  const ledger = new QuotaLedger();
  const primary = mockAdapter(() => okText("a"));
  const backup = mockAdapter(() => okText("b"));
  const deps = { registry, ledger, adapters: { openrouter: primary, "openrouter-backup": backup } };

  assert.equal((await runTask(task(), "prompt", deps)).ok, true);
  assert.equal((await runTask(task(), "prompt", deps)).ok, true);

  const third = await runTask(task(), "prompt", deps);
  assert.equal(third.ok, false);
  if (third.ok) return;
  assert.equal(third.code, "QUOTA_EXHAUSTED");
  assert.equal(third.queued, true);
  assert.equal(third.attempts.length, 0, "nessuna chiamata quando tutte le quote sono esaurite");
  assert.equal(primary.calls.length, 1);
  assert.equal(backup.calls.length, 1);
});

test("gateway: a slow provider times out and the next free model answers", async () => {
  const slow = mockAdapter(() => new Promise<never>(() => {}));
  const backup = mockAdapter(() => okText("veloce"));

  const result = await runTask(task({ timeoutMs: 10 }), "prompt", {
    registry: hostedFree(),
    ledger: new QuotaLedger(),
    adapters: { openrouter: slow, "openrouter-backup": backup },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.attempts.map((attempt) => attempt.outcome), ["TIMEOUT", "ok"]);
});

test("gateway: a rate limit closes the route for the hinted window", async () => {
  const registry = hostedFree();
  const ledger = new QuotaLedger();
  const primary = mockAdapter(() => ({ ok: false, code: "RATE_LIMITED" as const, retryAfterMs: 60_000 }));
  const backup = mockAdapter(() => okText("ok"));

  const result = await runTask(task(), "prompt", {
    registry,
    ledger,
    adapters: { openrouter: primary, "openrouter-backup": backup },
  });

  assert.equal(result.ok, true);
  assert.equal(ledger.blockedBy(providerById(registry, "openrouter")), "RATE_LIMITED");
});

test("gateway: confidential data only reaches a local model", async () => {
  const hosted = mockAdapter(() => okText("esterno"));
  const local = mockAdapter(() => okText("locale"));

  const result = await runTask(task({ dataClass: "CONFIDENTIAL" }), "prompt", {
    registry: defaultRegistry(),
    ledger: new QuotaLedger(),
    adapters: { openrouter: hosted, "openrouter-backup": hosted, ollama: local },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.providerId, "ollama");
  assert.equal(hosted.calls.length, 0);
});

test("gateway: SECRET data is rejected before any adapter runs", async () => {
  const adapter = mockAdapter(() => okText("mai"));

  const result = await runTask(task({ dataClass: "SECRET" }), "prompt", {
    registry: defaultRegistry(),
    ledger: new QuotaLedger(),
    adapters: { openrouter: adapter, ollama: adapter },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "PRIVACY_BLOCKED");
  assert.equal(result.queued, false);
  assert.equal(adapter.calls.length, 0);
});

test("gateway: any positive budget is refused before selection", async () => {
  const adapter = mockAdapter(() => okText("mai"));

  const result = await runTask(task({ requestedBudgetEur: 0.01 }), "prompt", {
    registry: defaultRegistry(),
    ledger: new QuotaLedger(),
    adapters: { openrouter: adapter },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "TASK_BUDGET_EXCEEDED");
  assert.equal(adapter.calls.length, 0);
});

test("gateway: attempts stay within the task request ceiling", async () => {
  const failing = mockAdapter(() => ({ ok: false, code: "INVALID_RESPONSE" as const }));

  const result = await runTask(task({ maxRequests: 1 }), "prompt", {
    registry: hostedFree(),
    ledger: new QuotaLedger(),
    adapters: { openrouter: failing, "openrouter-backup": failing },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.attempts.length, 1);
  assert.equal(result.queued, true);
});

test("gateway: audit details never carry provider credentials", async () => {
  const events: AuditEvent[] = [];
  const failing = mockAdapter(() => ({
    ok: false,
    code: "INVALID_RESPONSE" as const,
    detail: "upstream rejected sk-abcdef1234567890 and hf_ABCDEF123456 for this request",
  }));

  await runTask(task(), "prompt", {
    registry: hostedFree(),
    ledger: new QuotaLedger(),
    adapters: { openrouter: failing },
    audit: (event) => events.push(event),
  });

  const serialised = JSON.stringify(events);
  assert.equal(serialised.includes("sk-abcdef1234567890"), false);
  assert.equal(serialised.includes("hf_ABCDEF123456"), false);
  assert.match(serialised, /redacted-key/);

  assert.equal(redact("Bearer abcdefgh12345678"), "Bearer [redacted]");
  assert.equal(redact("AIza0123456789abcdefghijklmnop"), "[redacted-key]");
});
