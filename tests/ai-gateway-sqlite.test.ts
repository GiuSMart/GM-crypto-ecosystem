/**
 * Gateway wired to the persisted ledger: the checks here are the ones that must
 * survive a process restart, not just an in-memory map.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runTask } from "../src/lib/ai/gateway";
import { mockAdapter, okText } from "../src/lib/ai/providers/fixtures";
import { SqliteQuotaLedger } from "../src/lib/ai/quota-sqlite";
import { OPENROUTER_EVIDENCE, approvedOpenRouterRecord, pendingOpenRouterRouterRecord } from "../src/lib/ai/registry-seed";
import { AiStore } from "../src/lib/ai/store";
import type { AuditEvent, ProviderRecord, TaskRequest } from "../src/lib/ai/types";

const task = (over: Partial<TaskRequest> = {}): TaskRequest => ({
  taskId: "tsk_sqlite",
  objective: "prova persistente",
  dataClass: "PUBLIC",
  ...over,
});

function tempDbFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-ai-gw-"));
  return path.join(dir, "ai.db");
}

function cleanup(file: string): void {
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
}

const approved = () => approvedOpenRouterRecord();
const registry = (): ProviderRecord[] => [approved(), pendingOpenRouterRouterRecord()];

test("gateway: a successful call spends persisted quota and records an audit row", async () => {
  const file = tempDbFile();
  const store = AiStore.open(file);
  const adapter = mockAdapter(() => okText("risposta"));
  const events: AuditEvent[] = [];

  const result = await runTask(task(), "prompt pubblico", {
    registry: registry(),
    ledger: new SqliteQuotaLedger(store),
    adapters: { openrouter: adapter },
    audit: (event) => {
      events.push(event);
      store.recordAudit(event);
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.providerId, OPENROUTER_EVIDENCE.providerId);
  assert.equal(result.modelId, OPENROUTER_EVIDENCE.modelId);
  assert.equal(adapter.calls.length, 1);
  assert.equal(adapter.calls[0].provider.modelId, OPENROUTER_EVIDENCE.modelId, "la variante pending non deve essere usata");
  assert.equal(store.used(approved()), 1);
  store.close();

  const reopened = AiStore.open(file);
  assert.equal(reopened.used(approved()), 1);
  assert.ok(reopened.recentAudit(20).some((event) => event.action === "task.succeeded"));
  assert.ok(events.length >= 2);
  reopened.close();
  cleanup(file);
});

test("gateway: a billing prompt disables the route across a restart", async () => {
  const file = tempDbFile();
  const adapter = mockAdapter(() => ({ ok: false, code: "BILLING_REQUIRED" as const, detail: "credito richiesto" }));

  const first = AiStore.open(file);
  const firstRun = await runTask(task(), "prompt", {
    registry: registry(),
    ledger: new SqliteQuotaLedger(first),
    adapters: { openrouter: adapter },
  });
  assert.equal(firstRun.ok, false);
  if (firstRun.ok) return;
  assert.equal(firstRun.code, "BILLING_REQUIRED");
  first.close();

  const second = AiStore.open(file);
  assert.equal(second.blockedBy(approved()), "BILLING_REQUIRED");

  const secondRun = await runTask(task(), "prompt", {
    registry: registry(),
    ledger: new SqliteQuotaLedger(second),
    adapters: { openrouter: adapter },
  });
  assert.equal(secondRun.ok, false);
  if (secondRun.ok) return;
  assert.equal(secondRun.code, "BILLING_REQUIRED");
  assert.equal(secondRun.queued, true);
  assert.equal(adapter.calls.length, 1, "la route che chiede fatturazione non va ritentata");
  second.close();
  cleanup(file);
});

test("gateway: an exhausted persisted quota stays exhausted after a restart", async () => {
  const file = tempDbFile();
  const record = { ...approved(), limits: { ...approved().limits, requestsPerDay: 1 } };
  const adapter = mockAdapter(() => okText("ok"));

  const first = AiStore.open(file);
  const ok = await runTask(task(), "prompt", {
    registry: [record],
    ledger: new SqliteQuotaLedger(first),
    adapters: { openrouter: adapter },
  });
  assert.equal(ok.ok, true);
  first.close();

  const second = AiStore.open(file);
  const denied = await runTask(task(), "prompt", {
    registry: [record],
    ledger: new SqliteQuotaLedger(second),
    adapters: { openrouter: adapter },
  });
  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.equal(denied.code, "QUOTA_EXHAUSTED");
  assert.equal(denied.queued, true);
  assert.equal(adapter.calls.length, 1);
  second.close();
  cleanup(file);
});

test("gateway: confidential data never reaches the persisted hosted route", async () => {
  const file = tempDbFile();
  const store = AiStore.open(file);
  const adapter = mockAdapter(() => okText("non deve essere chiamato"));

  const result = await runTask(task({ dataClass: "CONFIDENTIAL" }), "dati interni", {
    registry: registry(),
    ledger: new SqliteQuotaLedger(store),
    adapters: { openrouter: adapter },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "PRIVACY_BLOCKED");
  assert.equal(adapter.calls.length, 0);
  assert.equal(store.used(approved()), 0, "un rifiuto di privacy non consuma quota");
  store.close();
  cleanup(file);
});

test("gateway: credentials in a provider error never reach the audit table", async () => {
  const file = tempDbFile();
  const store = AiStore.open(file);
  const secret = `sk-or-v1-${"c".repeat(32)}`;
  const adapter = mockAdapter(() => ({
    ok: false,
    code: "INVALID_RESPONSE" as const,
    detail: `upstream rejected ${secret}`,
  }));

  await runTask(task(), "prompt", {
    registry: registry(),
    ledger: new SqliteQuotaLedger(store),
    adapters: { openrouter: adapter },
    audit: (event) => store.recordAudit(event),
  });

  const serialised = JSON.stringify(store.recentAudit(50));
  assert.equal(serialised.includes(secret), false);
  assert.match(serialised, /redacted-key/);
  store.close();
  cleanup(file);
});
