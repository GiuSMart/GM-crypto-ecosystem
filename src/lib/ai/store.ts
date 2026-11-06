/**
 * SQLite-backed registry and quota store for the AI Collective.
 *
 * The store owns no policy: it persists records and counters, and the gateway
 * decides. `claim()` is the only place that spends quota and it runs inside a
 * BEGIN IMMEDIATE transaction, so two processes sharing the database cannot both
 * take the last request of a window.
 */
import { DatabaseSync } from "node:sqlite";
import { DAILY_WINDOW_MS } from "./quota";
import { AI_SCHEMA_SQL } from "./store-schema";
import type { AuditEvent, BillingModel, FailureCode, ProviderRecord, ProviderState } from "./types";

export type AttestationRecord = {
  taskId: string;
  userId: string;
  statementVersion: string;
  attestedAtMs: number;
};

export type QuotaClaim =
  | { ok: true; used: number; remaining: number }
  | { ok: false; code: FailureCode; used: number; remaining: number };

type ProviderRow = {
  provider_id: string;
  model_id: string;
  revision: string;
  state: ProviderState;
  billing: BillingModel;
  cost_per_request_eur: number;
  monthly_fixed_cost_eur: number;
  requires_payment_card: number;
  automatic_paid_upgrade: number;
  trains_on_free_tier: number;
  internal_data_approved: number;
  local_model: number;
  requests_per_day: number;
  max_input_tokens: number;
  max_output_tokens: number;
  context_tokens: number;
  tools: number;
  structured_output: number;
  evidence_url: string;
  evidence_checked_at: string;
  health: ProviderRecord["health"];
};

type QuotaRow = {
  window_start_ms: number;
  window_ms: number;
  used: number;
  limit_per_window: number;
  disabled_until_ms: number | null;
  disabled_code: string | null;
};

const PROVIDER_COLUMNS = `provider_id, model_id, revision, state, billing, cost_per_request_eur,
  monthly_fixed_cost_eur, requires_payment_card, automatic_paid_upgrade, trains_on_free_tier,
  internal_data_approved, local_model, requests_per_day, max_input_tokens, max_output_tokens,
  context_tokens, tools, structured_output, evidence_url, evidence_checked_at, health`;

function toRecord(row: ProviderRow): ProviderRecord {
  return {
    providerId: row.provider_id,
    modelId: row.model_id,
    version: row.revision,
    state: row.state,
    billing: row.billing,
    costPerRequestEur: row.cost_per_request_eur,
    monthlyFixedCostEur: row.monthly_fixed_cost_eur,
    requiresPaymentCard: row.requires_payment_card === 1,
    automaticPaidUpgrade: row.automatic_paid_upgrade === 1,
    trainsOnFreeTier: row.trains_on_free_tier === 1,
    internalDataApproved: row.internal_data_approved === 1,
    localModel: row.local_model === 1,
    limits: {
      requestsPerDay: row.requests_per_day,
      maxInputTokens: row.max_input_tokens,
      maxOutputTokens: row.max_output_tokens,
    },
    capabilities: {
      contextTokens: row.context_tokens,
      tools: row.tools === 1,
      structuredOutput: row.structured_output === 1,
    },
    officialPricingUrl: row.evidence_url,
    pricingCheckedAt: row.evidence_checked_at,
    health: row.health,
  };
}

function toParams(record: ProviderRecord, updatedAt: string): (string | number | null)[] {
  return [
    record.providerId,
    record.modelId,
    record.version,
    record.state,
    record.billing,
    record.costPerRequestEur,
    record.monthlyFixedCostEur,
    record.requiresPaymentCard ? 1 : 0,
    record.automaticPaidUpgrade ? 1 : 0,
    record.trainsOnFreeTier ? 1 : 0,
    record.internalDataApproved ? 1 : 0,
    record.localModel ? 1 : 0,
    record.limits.requestsPerDay,
    record.limits.maxInputTokens,
    record.limits.maxOutputTokens,
    record.capabilities.contextTokens,
    record.capabilities.tools ? 1 : 0,
    record.capabilities.structuredOutput ? 1 : 0,
    record.officialPricingUrl,
    record.pricingCheckedAt,
    record.health,
    updatedAt,
  ];
}

// PROVIDER_COLUMNS plus updated_at: derived once so the placeholder count and
// the column list cannot drift apart again.
const PROVIDER_PARAM_COUNT = PROVIDER_COLUMNS.split(",").length + 1;
const PROVIDER_PLACEHOLDERS = Array.from({ length: PROVIDER_PARAM_COUNT }, () => "?").join(", ")

const UPSERT_PROVIDER = `INSERT INTO ai_providers(${PROVIDER_COLUMNS}, updated_at)
  VALUES(${PROVIDER_PLACEHOLDERS})
  ON CONFLICT(provider_id, model_id) DO UPDATE SET
    revision = excluded.revision,
    state = excluded.state,
    billing = excluded.billing,
    cost_per_request_eur = excluded.cost_per_request_eur,
    monthly_fixed_cost_eur = excluded.monthly_fixed_cost_eur,
    requires_payment_card = excluded.requires_payment_card,
    automatic_paid_upgrade = excluded.automatic_paid_upgrade,
    trains_on_free_tier = excluded.trains_on_free_tier,
    internal_data_approved = excluded.internal_data_approved,
    local_model = excluded.local_model,
    requests_per_day = excluded.requests_per_day,
    max_input_tokens = excluded.max_input_tokens,
    max_output_tokens = excluded.max_output_tokens,
    context_tokens = excluded.context_tokens,
    tools = excluded.tools,
    structured_output = excluded.structured_output,
    evidence_url = excluded.evidence_url,
    evidence_checked_at = excluded.evidence_checked_at,
    health = excluded.health,
    updated_at = excluded.updated_at`;

const INSERT_PROVIDER_IF_MISSING = `INSERT OR IGNORE INTO ai_providers(${PROVIDER_COLUMNS}, updated_at)
  VALUES(${PROVIDER_PLACEHOLDERS})`;

export type AiStoreOptions = { now?: () => number };

export class AiStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private migrated = false;

  constructor(db: DatabaseSync, options: AiStoreOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
  }

  /** Open (or create) a database file. Tests should prefer an explicit path. */
  static open(dbPath: string, options: AiStoreOptions = {}): AiStore {
    return new AiStore(new DatabaseSync(dbPath), options);
  }

  /** Idempotent additive migration: safe to call on every start. */
  migrate(): void {
    if (this.migrated) return;
    this.db.exec("PRAGMA busy_timeout = 2000;");
    this.db.exec(AI_SCHEMA_SQL);
    this.migrated = true;
  }

  close(): void {
    this.db.close();
  }

  /** Names of the tables this store owns; used by the migration test. */
  tables(): string[] {
    this.migrate();
    return (
      this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ai_%' ORDER BY name")
        .all() as unknown as { name: string }[]
    ).map((row) => row.name);
  }

  saveProvider(record: ProviderRecord): void {
    this.migrate();
    this.db.prepare(UPSERT_PROVIDER).run(...toParams(record, new Date(this.now()).toISOString()));
  }

  /**
   * Insert a seed record only when it is missing. A reviewed decision (for
   * example REVIEW_REQUIRED after a terms change) is never silently reverted by
   * a restart.
   */
  seedProvider(record: ProviderRecord): void {
    this.migrate();
    this.db.prepare(INSERT_PROVIDER_IF_MISSING).run(...toParams(record, new Date(this.now()).toISOString()));
  }

  getProvider(providerId: string, modelId: string): ProviderRecord | null {
    this.migrate();
    const row = this.db
      .prepare(`SELECT ${PROVIDER_COLUMNS} FROM ai_providers WHERE provider_id = ? AND model_id = ?`)
      .get(providerId, modelId) as unknown as ProviderRow | undefined;
    return row ? toRecord(row) : null;
  }

  listProviders(): ProviderRecord[] {
    this.migrate();
    const rows = this.db
      .prepare(`SELECT ${PROVIDER_COLUMNS} FROM ai_providers ORDER BY provider_id, model_id`)
      .all() as unknown as ProviderRow[];
    return rows.map(toRecord);
  }

  remaining(provider: ProviderRecord): number {
    this.migrate();
    const row = this.readQuota(provider);
    if (!row) return provider.limits.requestsPerDay;
    const used = this.now() - row.window_start_ms >= row.window_ms ? 0 : row.used;
    return Math.max(0, row.limit_per_window - used);
  }

  used(provider: ProviderRecord): number {
    this.migrate();
    const row = this.readQuota(provider);
    if (!row) return 0;
    return this.now() - row.window_start_ms >= row.window_ms ? 0 : row.used;
  }

  blockedBy(provider: ProviderRecord): FailureCode | null {
    this.migrate();
    const row = this.readQuota(provider);
    if (!row || row.disabled_until_ms === null) return null;
    if (this.now() >= row.disabled_until_ms) return null;
    return (row.disabled_code as FailureCode | null) ?? "RATE_LIMITED";
  }

  /**
   * Spend one request from the current window. Atomic under BEGIN IMMEDIATE:
   * concurrent callers cannot both take the last slot, and a disabled route is
   * refused with its stored code.
   */
  claim(provider: ProviderRecord, options: { windowMs?: number; limit?: number } = {}): QuotaClaim {
    this.migrate();
    const windowMs = options.windowMs ?? DAILY_WINDOW_MS;
    const limit = Math.max(0, Math.floor(options.limit ?? provider.limits.requestsPerDay));
    const now = this.now();

    return this.transaction<QuotaClaim>(() => {
      this.db.prepare(INSERT_PROVIDER_IF_MISSING).run(...toParams(provider, new Date(now).toISOString()));
      const row = this.readQuota(provider);

      if (!row) {
        this.writeQuota(provider, {
          windowStartMs: now,
          windowMs,
          used: limit > 0 ? 1 : 0,
          limit,
          disabledUntilMs: null,
          disabledCode: null,
        });
        return limit > 0
          ? { ok: true, used: 1, remaining: limit - 1 }
          : { ok: false, code: "QUOTA_EXHAUSTED", used: 0, remaining: 0 };
      }

      if (row.disabled_until_ms !== null && now < row.disabled_until_ms) {
        return {
          ok: false,
          code: (row.disabled_code as FailureCode | null) ?? "RATE_LIMITED",
          used: row.used,
          remaining: Math.max(0, row.limit_per_window - row.used),
        };
      }

      const expired = now - row.window_start_ms >= row.window_ms;
      const windowStartMs = expired ? now : row.window_start_ms;
      const used = expired ? 0 : row.used;

      if (used >= row.limit_per_window) {
        this.writeQuota(provider, {
          windowStartMs,
          windowMs: row.window_ms,
          used,
          limit: row.limit_per_window,
          disabledUntilMs: windowStartMs + row.window_ms,
          disabledCode: "QUOTA_EXHAUSTED",
        });
        return { ok: false, code: "QUOTA_EXHAUSTED", used, remaining: 0 };
      }

      const nextUsed = used + 1;
      this.writeQuota(provider, {
        windowStartMs,
        windowMs: row.window_ms,
        used: nextUsed,
        limit: row.limit_per_window,
        disabledUntilMs: null,
        disabledCode: null,
      });
      return { ok: true, used: nextUsed, remaining: Math.max(0, row.limit_per_window - nextUsed) };
    });
  }

  /**
   * Claim one slot in a shared rolling window, for example requests per minute.
   * The claim is atomic under BEGIN IMMEDIATE, so two processes sharing the file
   * cannot both take the last slot of the window.
   */
  claimWindow(key: string, limit: number, windowMs: number): boolean {
    this.migrate();
    if (typeof key !== "string" || key.trim() === "") return false;
    const safeLimit = Math.floor(limit);
    if (!Number.isFinite(safeLimit) || safeLimit <= 0) return false;
    const safeWindow = Math.max(1, Math.floor(windowMs));
    const now = this.now();

    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT window_start_ms, window_ms, used, limit_per_window FROM ai_gate WHERE gate_key = ?")
        .get(key) as unknown as
        | { window_start_ms: number; window_ms: number; used: number; limit_per_window: number }
        | undefined;

      const expired = !row || now - row.window_start_ms >= row.window_ms;
      const windowStartMs = expired ? now : row.window_start_ms;
      const used = expired ? 0 : row.used;
      // The first claim of a window fixes its budget: a later caller cannot widen
      // a limit that is already being consumed (nor narrow it mid-window).
      const effectiveLimit = expired || !row ? safeLimit : row.limit_per_window;
      if (used >= effectiveLimit) return false;

      this.db
        .prepare(
          `INSERT INTO ai_gate(gate_key, window_start_ms, window_ms, used, limit_per_window)
           VALUES(?,?,?,?,?)
           ON CONFLICT(gate_key) DO UPDATE SET
             window_start_ms = excluded.window_start_ms,
             window_ms = excluded.window_ms,
             used = excluded.used,
             limit_per_window = excluded.limit_per_window`,
        )
        .run(key, windowStartMs, safeWindow, used + 1, effectiveLimit);
      return true;
    });
  }

  /** Close a route until `ms` elapses (never longer than one window). */
  disable(provider: ProviderRecord, code: FailureCode, ms?: number): void {
    this.migrate();
    const now = this.now();
    const duration = Math.max(1, Math.min(ms ?? DAILY_WINDOW_MS, DAILY_WINDOW_MS));

    this.transaction(() => {
      this.db.prepare(INSERT_PROVIDER_IF_MISSING).run(...toParams(provider, new Date(now).toISOString()));
      const row = this.readQuota(provider);
      this.writeQuota(provider, {
        windowStartMs: row?.window_start_ms ?? now,
        windowMs: row?.window_ms ?? DAILY_WINDOW_MS,
        used: row?.used ?? 0,
        limit: row?.limit_per_window ?? provider.limits.requestsPerDay,
        disabledUntilMs: now + duration,
        disabledCode: code,
      });
    });
  }

  /**
   * Persist the operator's PUBLIC attestation for a task. Written before the
   * provider call and never overwritten: a replayed task id is refused, so the
   * audit cannot be rewritten by a second request.
   */
  recordAttestation(record: AttestationRecord): void {
    this.migrate();
    if (record.taskId.trim() === "" || record.userId.trim() === "") {
      throw new Error("attestazione senza task o utente");
    }
    if (record.statementVersion.trim() === "") throw new Error("attestazione senza versione");
    if (!Number.isInteger(record.attestedAtMs) || record.attestedAtMs <= 0) {
      throw new Error("attestazione con timestamp non valido");
    }
    this.db
      .prepare(
        "INSERT INTO ai_attestation(task_id, user_id, statement_version, attested_at_ms) VALUES(?,?,?,?)",
      )
      .run(record.taskId, record.userId, record.statementVersion, record.attestedAtMs);
  }

  attestationFor(taskId: string): AttestationRecord | null {
    this.migrate();
    const row = this.db
      .prepare("SELECT task_id, user_id, statement_version, attested_at_ms FROM ai_attestation WHERE task_id = ?")
      .get(taskId) as unknown as
      | { task_id: string; user_id: string; statement_version: string; attested_at_ms: number }
      | undefined;
    return row
      ? {
          taskId: row.task_id,
          userId: row.user_id,
          statementVersion: row.statement_version,
          attestedAtMs: row.attested_at_ms,
        }
      : null;
  }

  recordAudit(event: AuditEvent): void {
    this.migrate();
    this.db
      .prepare("INSERT INTO ai_audit(ts, task_id, action, provider_id, model_id, code, detail) VALUES(?,?,?,?,?,?,?)")
      .run(
        event.ts,
        event.taskId,
        event.action,
        event.providerId ?? null,
        event.modelId ?? null,
        event.code ?? null,
        event.detail === undefined ? null : event.detail.slice(0, 300),
      );
  }

  recentAudit(limit = 50): AuditEvent[] {
    this.migrate();
    const rows = this.db
      .prepare("SELECT ts, task_id, action, provider_id, model_id, code, detail FROM ai_audit ORDER BY id DESC LIMIT ?")
      .all(limit) as unknown as {
      ts: string;
      task_id: string;
      action: AuditEvent["action"];
      provider_id: string | null;
      model_id: string | null;
      code: FailureCode | null;
      detail: string | null;
    }[];

    return rows.reverse().map((row) => {
      const event: AuditEvent = { ts: row.ts, taskId: row.task_id, action: row.action };
      if (row.provider_id) event.providerId = row.provider_id;
      if (row.model_id) event.modelId = row.model_id;
      if (row.code) event.code = row.code;
      if (row.detail) event.detail = row.detail;
      return event;
    });
  }

  private readQuota(provider: ProviderRecord): QuotaRow | null {
    const row = this.db
      .prepare(
        `SELECT window_start_ms, window_ms, used, limit_per_window, disabled_until_ms, disabled_code
         FROM ai_quota WHERE provider_id = ? AND model_id = ?`,
      )
      .get(provider.providerId, provider.modelId) as unknown as QuotaRow | undefined;
    return row ?? null;
  }

  private writeQuota(
    provider: ProviderRecord,
    state: {
      windowStartMs: number;
      windowMs: number;
      used: number;
      limit: number;
      disabledUntilMs: number | null;
      disabledCode: FailureCode | null;
    },
  ): void {
    this.db
      .prepare(
        `INSERT INTO ai_quota(provider_id, model_id, window_start_ms, window_ms, used, limit_per_window,
           disabled_until_ms, disabled_code, updated_at_ms)
         VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(provider_id, model_id) DO UPDATE SET
           window_start_ms = excluded.window_start_ms,
           window_ms = excluded.window_ms,
           used = excluded.used,
           limit_per_window = excluded.limit_per_window,
           disabled_until_ms = excluded.disabled_until_ms,
           disabled_code = excluded.disabled_code,
           updated_at_ms = excluded.updated_at_ms`,
      )
      .run(
        provider.providerId,
        provider.modelId,
        state.windowStartMs,
        state.windowMs,
        state.used,
        state.limit,
        state.disabledUntilMs,
        state.disabledCode,
        this.now(),
      );
  }

  private transaction<T>(fn: () => T): T {
    // The retry deadline must use the wall clock: an injected clock may not advance.
    const deadline = Date.now() + 2000;
    for (;;) {
      try {
        this.db.exec("BEGIN IMMEDIATE");
        break;
      } catch (error) {
        if (!isBusy(error) || this.now() >= deadline) throw error;
      }
    }
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // A failed rollback must not mask the original error.
      }
      throw error;
    }
  }
}

function isBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_BUSY|database is locked/i.test(message);
}
