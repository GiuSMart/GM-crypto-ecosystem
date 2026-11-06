/**
 * SQLite registry and quota store tests.
 *
 * Every test uses its own temporary database file: nothing here touches
 * `data/gm.db` or the application database.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { approvedOpenRouterRecord } from "../src/lib/ai/registry-seed";
import { AiStore } from "../src/lib/ai/store";
import type { ProviderRecord } from "../src/lib/ai/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function tempDbFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-ai-store-"));
  return path.join(dir, "ai.db");
}

function cleanup(file: string): void {
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
}

const withLimit = (limit: number): ProviderRecord => {
  const base = approvedOpenRouterRecord();
  return { ...base, limits: { ...base.limits, requestsPerDay: limit } };
};

// ai_gate holds the shared rolling windows (per-minute limits); it is additive too.
const AUDIT_TABLES = ["ai_attestation", "ai_audit", "ai_gate", "ai_providers", "ai_quota"];

test("store: the AI migration is additive and idempotent", () => {
  const file = tempDbFile();
  const first = AiStore.open(file);
  assert.deepEqual(first.tables(), AUDIT_TABLES);
  first.migrate();
  first.migrate();
  first.close();

  const second = AiStore.open(file);
  second.migrate();
  assert.deepEqual(second.tables(), AUDIT_TABLES);
  second.close();
  cleanup(file);
});

test("store: window usage can be read without consuming a slot", () => {
  let clock = 1_700_000_000_000;
  const file = tempDbFile();
  const store = AiStore.open(file, { now: () => clock });

  assert.equal(store.windowUsage("ai:user:usr_admin", DAY_MS).used, 0);
  assert.equal(store.claimWindow("ai:user:usr_admin", 20, DAY_MS), true);
  assert.equal(store.claimWindow("ai:user:usr_admin", 20, DAY_MS), true);

  const usage = store.windowUsage("ai:user:usr_admin", DAY_MS);
  assert.equal(usage.used, 2);
  assert.equal(usage.limit, 20);
  // Reading the panel twice must not spend two more requests.
  assert.equal(store.windowUsage("ai:user:usr_admin", DAY_MS).used, 2);

  clock += DAY_MS + 1;
  assert.equal(store.windowUsage("ai:user:usr_admin", DAY_MS).used, 0);

  store.close();
  cleanup(file);
});

test("store: a PUBLIC attestation is persisted, tied to user and task, and immutable", () => {
  const file = tempDbFile();
  const store = AiStore.open(file);
  const attestation = {
    taskId: "tsk_attested",
    userId: "usr_admin",
    statementVersion: "public-v1",
    attestedAtMs: 1_700_000_000_000,
  };

  store.recordAttestation(attestation);
  assert.deepEqual(store.attestationFor("tsk_attested"), attestation);
  assert.equal(store.attestationFor("tsk_missing"), null);

  // A replayed task id cannot rewrite who accepted responsibility.
  assert.throws(
    () => store.recordAttestation({ ...attestation, userId: "usr_other" }),
    /UNIQUE|constraint/i,
  );
  assert.equal(store.attestationFor("tsk_attested")?.userId, "usr_admin");

  assert.throws(
    () => store.recordAttestation({ ...attestation, taskId: "tsk_b", statementVersion: "" }),
    /versione/,
  );
  assert.throws(
    () => store.recordAttestation({ ...attestation, taskId: "tsk_c", attestedAtMs: 1.5 }),
    /timestamp/,
  );

  store.close();
  cleanup(file);
});

test("store: a provider record survives a reopen unchanged", () => {
  const file = tempDbFile();
  const record = approvedOpenRouterRecord();

  const first = AiStore.open(file);
  first.saveProvider(record);
  first.close();

  const second = AiStore.open(file);
  assert.deepEqual(second.getProvider(record.providerId, record.modelId), record);
  assert.deepEqual(second.listProviders(), [record]);
  second.close();
  cleanup(file);
});

test("store: seeding never overwrites a reviewed decision", () => {
  const file = tempDbFile();
  const store = AiStore.open(file);
  const record = approvedOpenRouterRecord();

  store.seedProvider(record);
  store.saveProvider({ ...record, state: "REVIEW_REQUIRED" });
  store.seedProvider(record);

  assert.equal(store.getProvider(record.providerId, record.modelId)?.state, "REVIEW_REQUIRED");
  store.close();
  cleanup(file);
});

test("store: the schema refuses a billing state the policy cannot reason about", () => {
  const file = tempDbFile();
  const store = AiStore.open(file);
  assert.throws(
    () => store.saveProvider({ ...approvedOpenRouterRecord(), billing: "FREEMIUM" as never }),
    /CHECK|constraint/i,
  );
  store.close();
  cleanup(file);
});

test("store: claim spends the window and blocks at exhaustion", () => {
  const file = tempDbFile();
  const store = AiStore.open(file);
  const record = withLimit(2);

  assert.deepEqual(store.claim(record), { ok: true, used: 1, remaining: 1 });
  assert.deepEqual(store.claim(record), { ok: true, used: 2, remaining: 0 });

  const third = store.claim(record);
  assert.equal(third.ok, false);
  if (third.ok) return;
  assert.equal(third.code, "QUOTA_EXHAUSTED");

  assert.equal(store.blockedBy(record), "QUOTA_EXHAUSTED");
  assert.equal(store.used(record), 2);
  assert.equal(store.remaining(record), 0);
  store.close();
  cleanup(file);
});

test("store: quota counters persist across a restart and reset with the window", () => {
  const file = tempDbFile();
  const record = withLimit(2);
  let clock = 1_700_000_000_000;

  const first = AiStore.open(file, { now: () => clock });
  first.claim(record);
  first.close();

  const second = AiStore.open(file, { now: () => clock });
  assert.equal(second.used(record), 1);
  second.claim(record);
  assert.equal(second.remaining(record), 0);

  clock += DAY_MS;
  assert.equal(second.used(record), 0);
  assert.equal(second.remaining(record), 2);
  assert.equal(second.claim(record).ok, true);
  second.close();
  cleanup(file);
});

test("store: a disabled route stays closed for its cooldown and then reopens", () => {
  const file = tempDbFile();
  let clock = 1_700_000_000_000;
  const store = AiStore.open(file, { now: () => clock });
  const record = approvedOpenRouterRecord();

  store.disable(record, "RATE_LIMITED", 30_000);
  assert.equal(store.blockedBy(record), "RATE_LIMITED");

  const duringCooldown = store.claim(record);
  assert.equal(duringCooldown.ok, false);
  if (!duringCooldown.ok) assert.equal(duringCooldown.code, "RATE_LIMITED");

  clock += 30_001;
  assert.equal(store.blockedBy(record), null);
  assert.equal(store.claim(record).ok, true);
  store.close();
  cleanup(file);
});

type ChildClaim = { ok: boolean; code?: string };

/**
 * Spend one claim from a separate Node process. Real concurrency is required:
 * a same-process test cannot prove that two writers share one file safely.
 */
function claimInChild(file: string, record: ProviderRecord): Promise<ChildClaim> {
  const storeUrl = pathToFileURL(path.join(process.cwd(), "src/lib/ai/store.ts")).href;
  const code = `
    import { AiStore } from ${JSON.stringify(storeUrl)};
    const store = AiStore.open(process.env.AI_DB_FILE);
    const claim = store.claim(JSON.parse(process.env.AI_RECORD));
    store.close();
    process.stdout.write(JSON.stringify(claim));
  `;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], {
      cwd: process.cwd(),
      env: { ...process.env, AI_DB_FILE: file, AI_RECORD: JSON.stringify(record) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (status) => {
      if (status !== 0) {
        reject(new Error(`processo figlio uscito con ${status}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as ChildClaim);
      } catch {
        reject(new Error(`output non valido: ${stdout}`));
      }
    });
  });
}

test("store: concurrent processes cannot overspend the request limit", async () => {
  const file = tempDbFile();
  const record = withLimit(3);

  const parent = AiStore.open(file);
  parent.migrate();
  parent.close();

  const results = await Promise.all(Array.from({ length: 8 }, () => claimInChild(file, record)));
  const granted = results.filter((result) => result.ok).length;
  const denied = results.filter((result) => !result.ok);

  assert.equal(granted, 3, `richieste concesse: ${granted}`);
  assert.ok(denied.length === 5);
  assert.ok(denied.every((result) => result.code === "QUOTA_EXHAUSTED"));

  const after = AiStore.open(file);
  assert.equal(after.used(record), 3);
  after.close();
  cleanup(file);
});

test("store: audit rows persist in order and are bounded to 300 characters", () => {
  const file = tempDbFile();
  const store = AiStore.open(file);

  store.recordAudit({ ts: "2026-11-05T10:00:00.000Z", taskId: "tsk_1", action: "task.received", detail: "x".repeat(600) });
  store.recordAudit({
    ts: "2026-11-05T10:00:01.000Z",
    taskId: "tsk_1",
    action: "task.succeeded",
    providerId: "openrouter",
    modelId: approvedOpenRouterRecord().modelId,
  });

  const rows = store.recentAudit(10);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].action, "task.received");
  assert.equal(rows[1].action, "task.succeeded");
  assert.equal((rows[0].detail ?? "").length, 300);
  store.close();
  cleanup(file);
});
