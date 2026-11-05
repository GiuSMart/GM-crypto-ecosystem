import assert from "node:assert/strict";
import test from "node:test";
import {
  OPENROUTER_ENDPOINT,
  createOpenRouterAdapter,
  isFreeModelId,
  parseOpenRouterConfig,
} from "../src/lib/ai/providers/openrouter";
import { OPENROUTER_EVIDENCE, approvedOpenRouterRecord } from "../src/lib/ai/registry-seed";
import type { ProviderRecord, TaskRequest } from "../src/lib/ai/types";

const API_KEY = `sk-or-v1-${"a".repeat(32)}`;
const MODEL = OPENROUTER_EVIDENCE.modelId;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const completion = (text = "ok", model = MODEL) =>
  json({ model, choices: [{ message: { content: text } }], usage: { prompt_tokens: 12, completion_tokens: 4 } });

const task = (over: Partial<TaskRequest> = {}): TaskRequest => ({
  taskId: "tsk_openrouter",
  objective: "prova adapter",
  dataClass: "PUBLIC",
  ...over,
});

const signal = () => new AbortController().signal;

function harness(
  respond: () => Response | Promise<Response>,
  options: { minuteLimit?: number; now?: () => number; record?: ProviderRecord } = {},
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return await respond();
  }) as typeof fetch;

  const adapter = createOpenRouterAdapter({
    apiKey: API_KEY,
    modelId: MODEL,
    maxOutputTokens: 1024,
    fetchImpl,
    ...(options.minuteLimit ? { minuteLimit: options.minuteLimit } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const record = options.record ?? approvedOpenRouterRecord();
  const run = (prompt = "contenuto pubblico", presented: ProviderRecord = record) =>
    adapter({ provider: presented, task: task(), prompt }, signal());

  return { calls, run };
}

test("adapter: disabled unless explicitly opted in with a key and a free model", () => {
  assert.equal(parseOpenRouterConfig({}).ok, false);
  assert.equal(parseOpenRouterConfig({ GM_AI_OPENROUTER: "true" }).ok, false);
  assert.equal(
    parseOpenRouterConfig({ GM_AI_OPENROUTER: "true", OPENROUTER_API_KEY: API_KEY }).ok,
    false,
    "senza modello non si attiva nulla",
  );
  assert.equal(
    parseOpenRouterConfig({
      GM_AI_OPENROUTER: "true",
      OPENROUTER_API_KEY: API_KEY,
      GM_AI_OPENROUTER_MODEL: "cohere/north-mini-code",
    }).ok,
    false,
    "un modello a pagamento non può essere configurato",
  );
  const ok = parseOpenRouterConfig({
    GM_AI_OPENROUTER: "true",
    OPENROUTER_API_KEY: API_KEY,
    GM_AI_OPENROUTER_MODEL: MODEL,
  });
  assert.equal(ok.ok, true);
});

test("adapter: only the :free variant is accepted, at construction and at call time", async () => {
  assert.equal(isFreeModelId(MODEL), true);
  assert.equal(isFreeModelId("cohere/north-mini-code"), false);
  assert.equal(isFreeModelId("openrouter/free"), false);
  assert.throws(
    () => createOpenRouterAdapter({ apiKey: API_KEY, modelId: "cohere/north-mini-code", maxOutputTokens: 100 }),
    /:free/,
  );

  const { calls, run } = harness(() => completion());
  const result = await run("ciao", { ...approvedOpenRouterRecord(), modelId: "some/other:free" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "MODEL_NOT_APPROVED");
  assert.equal(calls.length, 0);
});

test("adapter: sends one pinned free model with no fallback array and no retries", async () => {
  const { calls, run } = harness(() => completion("risposta"));
  const result = await run("prompt pubblico");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.text, "risposta");
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OPENROUTER_ENDPOINT);

  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${API_KEY}`);

  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
  assert.equal(body.model, MODEL);
  assert.equal("models" in body, false, "un array models può fatturare un fallback a pagamento");
  assert.deepEqual(body.provider, { allow_fallbacks: false, data_collection: "deny" });
  assert.equal(body.temperature, 0);
  assert.ok(Number(body.max_tokens) <= 1024);
});

test("adapter: maps 402 to BILLING_REQUIRED and redacts the key from the detail", async () => {
  const { run } = harness(() => json({ error: { message: `saldo negativo per la chiave ${API_KEY}` } }, 402));
  const result = await run();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "BILLING_REQUIRED");
  assert.equal(JSON.stringify(result).includes(API_KEY), false);
});

test("adapter: maps 429 to RATE_LIMITED and honours retry-after", async () => {
  const { run } = harness(() => json({ error: { message: "limite" } }, 429, { "retry-after": "30" }));
  const result = await run();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "RATE_LIMITED");
  assert.equal(result.retryAfterMs, 30_000);
});

test("adapter: maps authentication, missing model and server failures to typed errors", async () => {
  const cases: [number, string][] = [
    [401, "PROVIDER_UNAVAILABLE"],
    [403, "PROVIDER_UNAVAILABLE"],
    [404, "MODEL_NOT_APPROVED"],
    [503, "PROVIDER_UNAVAILABLE"],
    [400, "INVALID_RESPONSE"],
  ];

  for (const [status, code] of cases) {
    const { run } = harness(() => json({ error: { message: "errore" } }, status));
    const result = await run();
    assert.equal(result.ok, false, `HTTP ${status}`);
    if (result.ok) continue;
    assert.equal(result.code, code, `HTTP ${status}`);
  }
});

test("adapter: rejects invalid JSON, empty choices and a substituted model", async () => {
  const invalidJson = await harness(() => new Response("not-json", { status: 200 })).run();
  assert.equal(invalidJson.ok, false);
  if (!invalidJson.ok) assert.equal(invalidJson.code, "INVALID_RESPONSE");

  const noChoices = await harness(() => json({ model: MODEL, choices: [] })).run();
  assert.equal(noChoices.ok, false);
  if (!noChoices.ok) assert.equal(noChoices.code, "INVALID_RESPONSE");

  const substituted = await harness(() =>
    json({ model: "openai/gpt-5", choices: [{ message: { content: "testo" } }] }),
  ).run();
  assert.equal(substituted.ok, false);
  if (!substituted.ok) assert.equal(substituted.code, "INVALID_RESPONSE");
});

test("adapter: a refusal larger than the prompt budget never reaches the network", async () => {
  const record = { ...approvedOpenRouterRecord(), limits: { requestsPerDay: 50, maxInputTokens: 10, maxOutputTokens: 4 } };
  const { calls, run } = harness(() => completion(), { record });
  const result = await run("x".repeat(400));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "TASK_BUDGET_EXCEEDED");
  assert.equal(calls.length, 0);
});

test("adapter: local minute limiter stops a burst before the provider does", async () => {
  let clock = 1_700_000_000_000;
  const { calls, run } = harness(() => completion(), { minuteLimit: 2, now: () => clock });

  assert.equal((await run()).ok, true);
  assert.equal((await run()).ok, true);
  const third = await run();
  assert.equal(third.ok, false);
  if (third.ok) return;
  assert.equal(third.code, "RATE_LIMITED");
  assert.equal(calls.length, 2);

  clock += 60_000;
  assert.equal((await run()).ok, true);
  assert.equal(calls.length, 3);
});

test("adapter: an aborted request is a TIMEOUT, a network failure is PROVIDER_UNAVAILABLE", async () => {
  const aborted = createOpenRouterAdapter({
    apiKey: API_KEY,
    modelId: MODEL,
    maxOutputTokens: 512,
    fetchImpl: (async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }) as typeof fetch,
  });
  const timeout = await aborted({ provider: approvedOpenRouterRecord(), task: task(), prompt: "ciao" }, signal());
  assert.equal(timeout.ok, false);
  if (!timeout.ok) assert.equal(timeout.code, "TIMEOUT");

  const offline = createOpenRouterAdapter({
    apiKey: API_KEY,
    modelId: MODEL,
    maxOutputTokens: 512,
    fetchImpl: (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch,
  });
  const unavailable = await offline({ provider: approvedOpenRouterRecord(), task: task(), prompt: "ciao" }, signal());
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.code, "PROVIDER_UNAVAILABLE");
});
