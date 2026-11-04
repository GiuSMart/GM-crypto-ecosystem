/**
 * Contracts for the GM AI Collective provider gateway.
 *
 * These types are deliberately runtime-free: no provider SDK, no network, no
 * database. The gateway must stay testable with fixtures, so everything that
 * touches a provider is injected as a `ProviderAdapter`.
 *
 * See docs/GM_AI_COLLECTIVE_FREE_ONLY.md — Stage A (policy and contracts) and
 * Stage B (mocked gateway).
 */

/** Data classification, ordered from the least to the most sensitive. */
export type DataClassification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "SECRET";

export const DATA_CLASSIFICATIONS: readonly DataClassification[] = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "SECRET",
] as const;

/**
 * Registry states. Only APPROVED_FREE may receive work; discovery never grants
 * approval and unknown pricing is PENDING_REVIEW, never "free".
 */
export type ProviderState =
  | "DISCOVERED"
  | "PENDING_REVIEW"
  | "APPROVED_FREE"
  | "QUOTA_EXHAUSTED"
  | "REVIEW_REQUIRED"
  | "SUSPENDED"
  | "REJECTED";

/**
 * How a provider bills. FREE_NO_CARD is the only shape that can ever pass the
 * free-only gate; UNKNOWN deliberately fails closed.
 */
export type BillingModel = "FREE_NO_CARD" | "FREE_CARD_REQUIRED" | "UNKNOWN" | "PAID";

export type FailureCode =
  | "PROVIDER_UNAVAILABLE"
  | "QUOTA_EXHAUSTED"
  | "RATE_LIMITED"
  | "BILLING_REQUIRED"
  | "MODEL_NOT_APPROVED"
  | "PRIVACY_BLOCKED"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "TASK_BUDGET_EXCEEDED";

export type ProviderLimits = {
  /** Requests allowed in one reset window. */
  requestsPerDay: number;
  /** Hard cap on the prompt size the gateway will send. */
  maxInputTokens: number;
  /** Hard cap on generated tokens. */
  maxOutputTokens: number;
};

export type ProviderCapabilities = {
  contextTokens: number;
  tools: boolean;
  structuredOutput: boolean;
};

export type ProviderRecord = {
  providerId: string;
  modelId: string;
  version: string;
  state: ProviderState;
  billing: BillingModel;
  /** Marginal cost per request. Must be 0 for the free-only gate. */
  costPerRequestEur: number;
  /** Recurring fixed cost (plan, subscription). Must be 0. */
  monthlyFixedCostEur: number;
  requiresPaymentCard: boolean;
  /** True when overage or exhaustion silently upgrades to a paid plan. */
  automaticPaidUpgrade: boolean;
  /** True when the provider states it trains on free-tier submissions. */
  trainsOnFreeTier: boolean;
  /** Explicit privacy review that allows INTERNAL data on a hosted provider. */
  internalDataApproved: boolean;
  /** Runs on the owner's machine: no data leaves the host. */
  localModel: boolean;
  limits: ProviderLimits;
  capabilities: ProviderCapabilities;
  /** Evidence required before any approval: official page and check date. */
  officialPricingUrl: string;
  pricingCheckedAt: string;
  health: "unknown" | "ok" | "failing";
};

export type TaskRequest = {
  taskId: string;
  objective: string;
  dataClass: DataClassification;
  /** Any positive value is a policy violation under FREE_ONLY. */
  requestedBudgetEur?: number;
  maxRequests?: number;
  timeoutMs?: number;
  /** Optional narrowing; never widens eligibility. */
  providerAllowlist?: readonly string[];
};

export type AdapterRequest = {
  provider: ProviderRecord;
  task: TaskRequest;
  prompt: string;
};

export type AdapterSuccess = {
  ok: true;
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
};

export type AdapterFailure = {
  ok: false;
  code: FailureCode;
  retryAfterMs?: number;
  detail?: string;
};

export type AdapterResult = AdapterSuccess | AdapterFailure;

/** Injected transport. Must never be called for a non-approved provider. */
export type ProviderAdapter = (request: AdapterRequest, signal: AbortSignal) => Promise<AdapterResult>;

export type GatewayAttempt = {
  providerId: string;
  modelId: string;
  version: string;
  outcome: "ok" | FailureCode;
  durationMs: number;
  usage?: { inputTokens: number; outputTokens: number };
};

export type GatewaySuccess = {
  ok: true;
  providerId: string;
  modelId: string;
  version: string;
  text: string;
  attempts: GatewayAttempt[];
};

export type GatewayFailure = {
  ok: false;
  code: FailureCode;
  attempts: GatewayAttempt[];
  /** True when the work was parked instead of escalated to a paid route. */
  queued: boolean;
};

export type GatewayResult = GatewaySuccess | GatewayFailure;

export type AuditAction =
  | "task.received"
  | "task.succeeded"
  | "task.failed"
  | "task.queued"
  | "provider.selected"
  | "provider.skipped"
  | "provider.failed"
  | "provider.disabled";

export type AuditEvent = {
  ts: string;
  taskId: string;
  action: AuditAction;
  providerId?: string;
  modelId?: string;
  code?: FailureCode;
  detail?: string;
};

/** Audit sink. The application wires this to `audit()`; tests keep it in memory. */
export type AuditSink = (event: AuditEvent) => void;
