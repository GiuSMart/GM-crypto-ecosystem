/**
 * Financial boundary: nothing in the AI Collective may place an order, move money
 * or reach a trading/withdrawal endpoint. These are structural tests plus one
 * live hard-stop check, so a future import cannot quietly reopen the boundary.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../src/lib/config";
import { runTask } from "../src/lib/ai/gateway";
import { mockAdapter, okText } from "../src/lib/ai/providers/fixtures";
import { createAiRuntime } from "../src/lib/ai/runtime";
import { OPENROUTER_EVIDENCE, approvedOpenRouterRecord } from "../src/lib/ai/registry-seed";
import { AiStore } from "../src/lib/ai/store";
import type { TaskRequest } from "../src/lib/ai/types";
import { executeLiveOrder, liveBlockers } from "../src/lib/live";

const task = (over: Partial<TaskRequest> = {}): TaskRequest => ({
  taskId: "tsk_boundary",
  objective: "verifica del confine finanziario",
  dataClass: "PUBLIC",
  ...over,
});

function tempDbFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-ai-boundary-"));
  return path.join(dir, "ai.db");
}

function cleanup(file: string): void {
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
}

const FAKE_KEY = `sk-or-v1-${"d".repeat(32)}`;

function aiSources(): { name: string; source: string }[] {
  const root = path.join(process.cwd(), "src/lib/ai");
  const files = [
    ...fs.readdirSync(root).filter((name) => name.endsWith(".ts")).map((name) => path.join(root, name)),
    ...fs
      .readdirSync(path.join(root, "providers"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => path.join(root, "providers", name)),
  ];
  return files.map((file) => ({ name: path.relative(root, file), source: fs.readFileSync(file, "utf8") }));
}

test("boundary: live order placement still throws unconditionally", async () => {
  await assert.rejects(() => executeLiveOrder(), /Esecuzione live non disponibile|non disponibile/i);

  const blockers = liveBlockers({
    authorization: {
      id: "live_test",
      user_id: "usr_demo",
      granted_by: "usr_admin",
      granted_at: "2026-11-05T00:00:00.000Z",
      revoked_at: null,
      max_order_quote: 100,
      max_daily_loss_quote: 10,
      note: null,
    },
    settings: { ...DEFAULT_SETTINGS, liveTradingEnabled: true, maxOrderQuote: 100 },
    credentialCount: 1,
  });

  assert.equal(blockers.length, 1, "anche con tutto il resto soddisfatto resta il blocco dell'order router");
  assert.match(blockers[0], /Order router live non implementato/);
});

test("boundary: the collective modules import no trading, wallet or credential path", () => {
  const forbidden = /from\s+"[^"]*\/(live|paper|credentials|wallets|venues|market|scan|subscriptions|engine\/fees)(\.ts)?"/;
  for (const { name, source } of aiSources()) {
    // intelligence.ts is the pre-existing deterministic report generator; it reads
    // market and paper data and is covered by its own read-only test below.
    if (name === "intelligence.ts") continue;
    assert.equal(forbidden.test(source), false, `${name} importa un modulo finanziario`);
    assert.equal(/INSERT\s+INTO\s+(paper_trades|live_authorizations|wallets|credentials|subscriptions)/i.test(source), false, `${name} scrive su una tabella finanziaria`);
    assert.equal(/executeLiveOrder|placeOrder|createOrder|withdraw/i.test(source), false, `${name} contiene un percorso di ordine o prelievo`);
  }
});

test("boundary: the legacy deterministic report stays read-only", () => {
  const legacy = aiSources().find(({ name }) => name === "intelligence.ts");
  assert.ok(legacy, "intelligence.ts deve restare presente");
  assert.equal(/INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM/i.test(legacy.source), false, "il report non deve scrivere nel database");
  assert.equal(/executeLiveOrder|placeOrder|createOrder|withdraw/i.test(legacy.source), false);
  assert.equal(/(^|[^.\w])fetch\(/.test(legacy.source), false, "il report non deve avere accesso di rete");
});

test("boundary: only the provider adapter is allowed to touch the network", () => {
  const networked = aiSources()
    .filter(({ source }) => /(^|[^.\w])fetch\(/.test(source))
    .map(({ name }) => name)
    .sort();

  assert.deepEqual(networked, ["providers/openrouter.ts"]);
});

test("boundary: the runtime is inert without explicit opt-in", async () => {
  const file = tempDbFile();
  const store = AiStore.open(file);
  const runtime = createAiRuntime(store, {});

  assert.equal(runtime.status.enabled, false);
  assert.deepEqual(runtime.status.adapters, []);
  assert.equal(runtime.status.budgetEur, 0);

  const result = await runtime.run(task(), "prompt");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "PROVIDER_UNAVAILABLE");
  assert.equal(result.queued, true);
  assert.equal(store.used(approvedOpenRouterRecord()), 0);

  store.close();
  cleanup(file);
});

test("boundary: a paid model cannot be configured into the runtime", () => {
  const file = tempDbFile();
  const store = AiStore.open(file);

  const paid = createAiRuntime(store, {
    GM_AI_OPENROUTER: "true",
    OPENROUTER_API_KEY: FAKE_KEY,
    GM_AI_OPENROUTER_MODEL: "cohere/north-mini-code",
  });
  assert.equal(paid.status.enabled, false);
  assert.match(paid.status.reason, /:free/);
  assert.deepEqual(paid.status.adapters, []);

  const noKey = createAiRuntime(store, { GM_AI_OPENROUTER: "true", GM_AI_OPENROUTER_MODEL: OPENROUTER_EVIDENCE.modelId });
  assert.equal(noKey.status.enabled, false);

  store.close();
  cleanup(file);
});

test("boundary: with the adapter enabled, SECRET input is still stopped before the network", async () => {
  const file = tempDbFile();
  const store = AiStore.open(file);
  const runtime = createAiRuntime(store, {
    GM_AI_OPENROUTER: "true",
    OPENROUTER_API_KEY: FAKE_KEY,
    GM_AI_OPENROUTER_MODEL: OPENROUTER_EVIDENCE.modelId,
  });
  assert.equal(runtime.status.enabled, true);
  assert.deepEqual(runtime.status.adapters, ["openrouter"]);

  const result = await runtime.run(task({ dataClass: "SECRET" }), "chiave privata");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "PRIVACY_BLOCKED");
  assert.equal(result.attempts.length, 0);
  assert.equal(store.used(approvedOpenRouterRecord()), 0, "nessuna quota spesa senza chiamata");

  store.close();
  cleanup(file);
});

test("boundary: a budget above zero is refused with the network adapter present", async () => {
  const adapter = mockAdapter(() => okText("non deve essere chiamato"));
  const result = await runTask(task({ requestedBudgetEur: 0.01 }), "prompt", {
    registry: [approvedOpenRouterRecord()],
    ledger: {
      remaining: () => 50,
      used: () => 0,
      blockedBy: () => null,
      consume: () => true,
      disable: () => undefined,
    },
    adapters: { openrouter: adapter },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "TASK_BUDGET_EXCEEDED");
  assert.equal(adapter.calls.length, 0);
});
