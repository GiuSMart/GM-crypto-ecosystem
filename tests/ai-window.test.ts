/**
 * Shared rolling windows: the per-minute limit must hold across processes, not
 * only inside one Node instance. `claimWindow` is the atomic primitive; these
 * tests cover exhaustion, expiry, persistence and real child processes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runTask } from "../src/lib/ai/gateway";
import { mockAdapter, okText } from "../src/lib/ai/providers/fixtures";
import { SqliteQuotaLedger } from "../src/lib/ai/quota-sqlite";
import { approvedOpenRouterRecord } from "../src/lib/ai/registry-seed";
import { AiStore } from "../src/lib/ai/store";
import type { TaskRequest } from "../src/lib/ai/types";

function tempDbFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-ai-window-"));
  return path.join(dir, "ai.db");
}

function cleanup(file: string): void {
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
}

const task: TaskRequest = {
  taskId: "tsk_window",
  objective: "prova finestra",
  dataClass: "PUBLIC",
};

test("claimWindow grants exactly the limit and refuses the rest", () => {
  const file = tempDbFile();
  let now = 1_000_000;
  const store = AiStore.open(file, { now: () => now });

  assert.deepEqual(
    [1, 2, 3].map(() => store.claimWindow("ai:minute:test", 2, 60_000)),
    [true, true, false],
  );
  store.close();
  cleanup(file);
});

test("the window reopens exactly after its length", () => {
  const file = tempDbFile();
  let now = 1_000_000;
  const store = AiStore.open(file, { now: () => now });

  assert.equal(store.claimWindow("k", 1, 60_000), true);
  assert.equal(store.claimWindow("k", 1, 60_000), false);
  now += 59_999;
  assert.equal(store.claimWindow("k", 1, 60_000), false);
  now += 1;
  assert.equal(store.claimWindow("k", 1, 60_000), true);

  store.close();
  cleanup(file);
});

test("different keys never share a budget", () => {
  const file = tempDbFile();
  const store = AiStore.open(file);
  assert.equal(store.claimWindow("ai:user:a", 1, 60_000), true);
  assert.equal(store.claimWindow("ai:user:a", 1, 60_000), false);
  assert.equal(store.claimWindow("ai:user:b", 1, 60_000), true);
  store.close();
  cleanup(file);
});

test("an unusable limit or key is refused instead of granting access", () => {
  const file = tempDbFile();
  const store = AiStore.open(file);
  assert.equal(store.claimWindow("k", 0, 60_000), false);
  assert.equal(store.claimWindow("k", Number.NaN, 60_000), false);
  assert.equal(store.claimWindow("k", -1, 60_000), false);
  assert.equal(store.claimWindow("   ", 1, 60_000), false);
  store.close();
  cleanup(file);
});

test("a spent window survives a restart", () => {
  const file = tempDbFile();
  const first = AiStore.open(file);
  assert.equal(first.claimWindow("ai:user:persisted", 2, 60_000), true);
  assert.equal(first.claimWindow("ai:user:persisted", 2, 60_000), true);
  first.close();

  const second = AiStore.open(file);
  assert.equal(second.claimWindow("ai:user:persisted", 2, 60_000), false);
  second.close();
  cleanup(file);
});

const WORKER = `
import { AiStore } from ${JSON.stringify(pathToFileURL(path.join(process.cwd(), "src/lib/ai/store.ts")).href)};
const store = AiStore.open(process.env.GM_TEST_DB);
const ok = store.claimWindow("ai:minute:openrouter", 3, 60000);
store.close();
console.log(JSON.stringify({ ok }));
`;

function claimInChild(dbPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", WORKER], {
      env: { ...process.env, GM_TEST_DB: dbPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += String(chunk)));
    child.stderr.on("data", (chunk) => (err += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`worker exited ${code}: ${err.slice(0, 300)}`));
        return;
      }
      try {
        const last = out.trim().split("\n").pop() ?? "{}";
        resolve(Boolean((JSON.parse(last) as { ok?: boolean }).ok));
      } catch (error) {
        reject(error);
      }
    });
  });
}

test("concurrent processes cannot exceed the shared limit", async () => {
  const file = tempDbFile();
  // Migrate once before the race so the children only contend on the claim.
  AiStore.open(file).close();

  const grants = await Promise.all(Array.from({ length: 8 }, () => claimInChild(file)));
  assert.equal(grants.filter(Boolean).length, 3);

  cleanup(file);
});

test("the gateway refuses to send when the shared minute window is exhausted", async () => {
  const file = tempDbFile();
  const store = AiStore.open(file);
  const record = approvedOpenRouterRecord();
  // Spend the only slot of the window before the gateway asks for one.
  assert.equal(store.claimWindow(`ai:minute:${record.providerId}`, 1, 60_000), true);

  const adapter = mockAdapter(() => okText("non deve essere chiamato"));
  const result = await runTask(task, "prompt", {
    registry: [record],
    ledger: new SqliteQuotaLedger(store),
    adapters: { openrouter: adapter },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "RATE_LIMITED");
  assert.equal(result.queued, true);
  assert.equal(adapter.calls.length, 0);
  assert.equal(store.used(record), 0, "un rifiuto per limite condiviso non consuma la quota giornaliera");
  store.close();
  cleanup(file);
});
