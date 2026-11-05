/**
 * Server-side composition of the free-only AI Collective.
 *
 * This is the only place that ties the pieces together: the SQLite store, the
 * persisted quota ledger, the approved seed records and the single real adapter.
 * It is server-only by construction — it imports `db.ts`, which opens SQLite —
 * and no client component may import it.
 *
 * Fail-closed default: with no explicit opt-in the runtime exposes no adapter, so
 * every task is queued with PROVIDER_UNAVAILABLE instead of reaching a provider.
 */
import { getDb } from "../db";
import { runTask } from "./gateway";
import { SqliteQuotaLedger } from "./quota-sqlite";
import { createOpenRouterAdapter, parseOpenRouterConfig } from "./providers/openrouter";
import { approvedOpenRouterRecord, pendingOpenRouterRouterRecord } from "./registry-seed";
import { AiStore } from "./store";
import type { GatewayResult, ProviderAdapter, TaskRequest } from "./types";

export type AiRuntimeStatus = {
  enabled: boolean;
  reason: string;
  adapters: string[];
  budgetEur: 0;
};

export type AiRuntime = {
  status: AiRuntimeStatus;
  run(task: TaskRequest, prompt: string): Promise<GatewayResult>;
  store: AiStore;
};

export function createAiRuntime(
  store: AiStore,
  env: Record<string, string | undefined> = process.env,
): AiRuntime {
  store.migrate();

  // Seeds never overwrite an existing row: a reviewed state survives restarts.
  const approved = approvedOpenRouterRecord();
  store.seedProvider(approved);
  store.seedProvider(pendingOpenRouterRouterRecord());

  const registry = store.listProviders();
  const ledger = new SqliteQuotaLedger(store);
  const adapters: Record<string, ProviderAdapter | undefined> = {};

  const config = parseOpenRouterConfig(env);
  if (config.ok) adapters[approved.providerId] = createOpenRouterAdapter(config.config);

  return {
    status: {
      enabled: config.ok,
      reason: config.ok ? "OpenRouter attivo sulla sola variante :free approvata" : config.reason,
      adapters: Object.keys(adapters),
      budgetEur: 0,
    },
    store,
    run: (task, prompt) =>
      runTask(task, prompt, {
        registry,
        ledger,
        adapters,
        audit: (event) => store.recordAudit(event),
      }),
  };
}

/** Runtime bound to the application database. Call from server code only. */
export function getAiRuntime(env: Record<string, string | undefined> = process.env): AiRuntime {
  return createAiRuntime(new AiStore(getDb()), env);
}
