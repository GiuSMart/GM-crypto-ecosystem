import test from "node:test";
import assert from "node:assert/strict";
import { parseAiRequest, toAiResponse } from "../src/lib/ai/http";
import { ROUTE_LIMITS } from "../src/lib/ai/policy";
import type { FailureCode, GatewayResult } from "../src/lib/ai/types";

const VALID = { objective: "Riassumi il testo", prompt: "Testo pubblico di prova" };

test("a minimal body becomes a PUBLIC task with a server-side id and one attempt", () => {
  const parsed = parseAiRequest(VALID, "tsk_1");
  assert.ok(parsed.ok);
  assert.equal(parsed.task.taskId, "tsk_1");
  assert.equal(parsed.task.dataClass, "PUBLIC");
  assert.equal(parsed.task.maxRequests, 1);
  assert.equal(parsed.task.requestedBudgetEur, undefined);
  assert.equal(parsed.prompt, "Testo pubblico di prova");
  assert.equal(parsed.task.objective, "Riassumi il testo");
});

test("the client can never choose classification, budget, provider or model", () => {
  const fields = [
    "dataClass",
    "dataClassification",
    "requestedBudgetEur",
    "budget",
    "budgetEur",
    "mode",
    "provider",
    "providerAllowlist",
    "model",
    "modelId",
    "messages",
    "system",
    "tools",
    "maxRequests",
    "timeoutMs",
  ];
  for (const field of fields) {
    const parsed = parseAiRequest({ ...VALID, [field]: "anything" }, "tsk_1");
    assert.equal(parsed.ok, false, `${field} deve essere rifiutato`);
    if (parsed.ok) return;
    assert.equal(parsed.status, 400);
    assert.match(parsed.error, new RegExp(field));
  }
});

test("malformed bodies are refused", () => {
  const bodies: unknown[] = [
    null,
    [],
    "string",
    42,
    {},
    { objective: "", prompt: "x" },
    { objective: "   ", prompt: "x" },
    { objective: "ok", prompt: "" },
    { objective: "ok", prompt: "   " },
    { objective: 123, prompt: "x" },
    { objective: "ok", prompt: 123 },
  ];
  for (const body of bodies) {
    const parsed = parseAiRequest(body, "tsk_1");
    assert.equal(parsed.ok, false, JSON.stringify(body));
    if (parsed.ok) return;
    assert.equal(parsed.status, 400);
  }
});

test("a prompt over the provider ceiling is refused with 413", () => {
  const parsed = parseAiRequest(
    { ...VALID, prompt: "a".repeat(ROUTE_LIMITS.maxPromptChars + 1) },
    "tsk_1",
  );
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.status, 413);

  const atLimit = parseAiRequest(
    { ...VALID, prompt: "a".repeat(ROUTE_LIMITS.maxPromptChars) },
    "tsk_1",
  );
  assert.equal(atLimit.ok, true);
});

test("an objective over the limit is refused", () => {
  const parsed = parseAiRequest(
    { ...VALID, objective: "b".repeat(ROUTE_LIMITS.maxObjectiveChars + 1) },
    "tsk_1",
  );
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.status, 400);
});

test("a missing server task id is an internal error, never a task without a trace", () => {
  for (const taskId of ["", "   "]) {
    const parsed = parseAiRequest(VALID, taskId);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.status, 500);
  }
});

const success: GatewayResult = {
  ok: true,
  providerId: "openrouter",
  modelId: "cohere/north-mini-code:free",
  version: "north-mini-code-20260617",
  text: "risposta",
  attempts: [
    {
      providerId: "openrouter",
      modelId: "cohere/north-mini-code:free",
      version: "north-mini-code-20260617",
      outcome: "ok",
      durationMs: 12,
      usage: { inputTokens: 10, outputTokens: 4 },
    },
  ],
};

test("a successful gateway result becomes a 200 with the answer and safe attempts", () => {
  const response = toAiResponse(success);
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.text, "risposta");
  assert.deepEqual(response.body.attempts, success.attempts);
  assert.equal(response.body.error, undefined);
});

test("every failure code maps to a stable status and a safe message", () => {
  const expected: Record<FailureCode, number> = {
    PRIVACY_BLOCKED: 403,
    TASK_BUDGET_EXCEEDED: 400,
    MODEL_NOT_APPROVED: 422,
    QUOTA_EXHAUSTED: 429,
    RATE_LIMITED: 429,
    BILLING_REQUIRED: 402,
    TIMEOUT: 504,
    INVALID_RESPONSE: 502,
    PROVIDER_UNAVAILABLE: 503,
  };
  for (const [code, status] of Object.entries(expected) as [FailureCode, number][]) {
    const response = toAiResponse({ ok: false, code, attempts: [], queued: code !== "PRIVACY_BLOCKED" });
    assert.equal(response.status, status, code);
    assert.equal(response.body.code, code);
    assert.equal(typeof response.body.error, "string");
    assert.equal(response.body.queued, code !== "PRIVACY_BLOCKED");
  }
});

test("a provider failure never returns internal details or credentials", () => {
  const secret = `sk-or-v1-${"d".repeat(32)}`;
  const failure: GatewayResult & { detail?: string } = {
    ok: false,
    code: "INVALID_RESPONSE",
    attempts: [
      {
        providerId: "openrouter",
        modelId: "cohere/north-mini-code:free",
        version: "v",
        outcome: "INVALID_RESPONSE",
        durationMs: 3,
      },
    ],
    queued: true,
  };
  // A rogue field must not be forwarded by the mapper.
  failure.detail = `upstream rejected ${secret}`;
  const response = toAiResponse(failure);
  const serialised = JSON.stringify(response);
  assert.equal(serialised.includes(secret), false);
  assert.equal(serialised.includes("upstream rejected"), false);
  assert.equal(serialised.includes("sk-"), false);
});
