/**
 * Risk Guard — deterministic, independent of every AI model.
 *
 * This module is the single authority that may approve or reject a trade intent.
 * Design rules, all of them deliberate:
 *
 * 1. It is a pure function of its inputs: no network, no clock except the explicit
 *    `now`, no randomness, no language model. Nothing an agent "decides" reaches it.
 * 2. It fails closed. Missing, invalid or non-finite data blocks the intent; it
 *    never defaults to a permissive value.
 * 3. It never mutates the policy. Limits are supplied read-only by the caller
 *    (settings table / operator) and the guard only reports violations.
 * 4. Live execution is blocked unconditionally in this build, as a second lock
 *    that is independent of the settings flag and of any admin authorization.
 *
 * Every violation is returned with a stable code so it can be audited and tested.
 */

import type { Book } from "./arbitrage";

/** Stable identifiers for every blocking condition. */
export type RiskViolationCode =
  | "POLICY_INVALID"
  | "DATA_INCOMPLETE"
  | "LIVE_EXECUTION_DISABLED"
  | "SYSTEM_HALTED"
  | "EMERGENCY_STOP_ACTIVE"
  | "STRATEGY_NOT_AUTHORIZED"
  | "BUY_VENUE_NOT_AUTHORIZED"
  | "SELL_VENUE_NOT_AUTHORIZED"
  | "ORDER_ABOVE_CAP"
  | "ORDER_RATE_LIMIT"
  | "INSUFFICIENT_CAPITAL"
  | "TOTAL_EXPOSURE_LIMIT"
  | "VENUE_EXPOSURE_LIMIT"
  | "STRATEGY_EXPOSURE_LIMIT"
  | "DAILY_LOSS_LIMIT"
  | "DRAWDOWN_LIMIT"
  | "SLIPPAGE_LIMIT"
  | "FEE_UNVERIFIED"
  | "STALE_DATA"
  | "INSUFFICIENT_LIQUIDITY";

export type RiskWarningCode =
  | "NEAR_ORDER_CAP"
  | "NEAR_DAILY_LOSS_LIMIT"
  | "NEAR_DRAWDOWN_LIMIT"
  | "SYSTEM_DEGRADED";

export type RiskViolation = {
  code: RiskViolationCode;
  /** Human-readable, safe to write to the audit log. */
  message: string;
  /** Configured limit, when the check is numeric. */
  limit?: number;
  /** Observed value that breached the limit. */
  value?: number;
};

export type RiskWarning = {
  code: RiskWarningCode;
  message: string;
  limit?: number;
  value?: number;
};

/**
 * Operator-defined limits. Every field is mandatory: a partially configured
 * policy is rejected rather than silently treated as unlimited.
 */
export type RiskPolicy = {
  /** Maximum quote notional for a single order, both legs included. */
  maxOrderQuote: number;
  /** Maximum number of paper opens allowed in a rolling hour. */
  maxOrdersPerHour: number;
  /** Stop trading for the day once realized P&L falls to minus this amount. */
  maxDailyLossQuote: number;
  /** Stop trading when equity falls this percentage below its peak. */
  maxDrawdownPct: number;
  /** Aggregate exposure across every open position. */
  maxTotalExposureQuote: number;
  /** Exposure allowed against a single venue. */
  maxVenueExposureQuote: number;
  /** Exposure allowed for a single strategy. */
  maxStrategyExposureQuote: number;
  /** Maximum tolerated depth-weighted slippage for the intent. */
  maxSlippagePct: number;
  /** Books older than this cannot be traded. */
  maxDataAgeMs: number;
  /** Capital that must remain untouched after the order. */
  minFreeCapitalQuote: number;
  /** Venues explicitly authorized for this account. */
  allowedVenues: string[];
  /** Strategies explicitly authorized for this account. */
  allowedStrategies: string[];
  /** When true (the only supported value today) live execution is rejected. */
  paperModeOnly: boolean;
};

export type TradeIntent = {
  pair: string;
  buyVenue: string;
  sellVenue: string;
  strategy: string;
  notionalQuote: number;
  /** Depth-weighted slippage already computed by the engine for this size. */
  expectedSlippagePct: number;
  /** False when the taker fee is unverified: an unknown cost can never trade. */
  feeVerified: boolean;
  /** Age of the oldest book used by the signal. */
  dataAgeMs: number;
  /** True only when both legs were fully filled from observed depth. */
  liquidityComplete: boolean;
  /** Paper intents are simulated; live intents are refused unconditionally here. */
  mode: "paper" | "live";
};

export type PortfolioState = {
  /** Realized P&L since the start of the current UTC day, quote currency. */
  dailyRealizedPnlQuote: number;
  /** Highest equity ever recorded, used for the drawdown check. */
  peakEquityQuote: number;
  equityQuote: number;
  /** Exposure already committed to open positions. */
  totalExposureQuote: number;
  venueExposureQuote: Record<string, number>;
  strategyExposureQuote: Record<string, number>;
  /** Capital still available to commit. */
  availableCapitalQuote: number;
  /** Number of this user's paper positions opened in the preceding rolling hour. */
  ordersLastHour: number;
  systemState: "operational" | "degraded" | "halted";
  /** Operator kill switch: overrides everything. */
  emergencyStop: boolean;
};

export type RiskVerdict = {
  approved: boolean;
  violations: RiskViolation[];
  warnings: RiskWarning[];
  /** Number of blocking checks evaluated, for auditing the guard itself. */
  checksEvaluated: number;
  /** True when the policy itself was rejected and no trade can be approved. */
  policyRejected: boolean;
};

/**
 * Conservative defaults. They are a starting point, not a recommendation, and
 * they are never raised automatically by any agent or by this module.
 */
export const DEFAULT_RISK_POLICY: RiskPolicy = {
  maxOrderQuote: 500,
  maxOrdersPerHour: 10,
  maxDailyLossQuote: 25,
  maxDrawdownPct: 10,
  maxTotalExposureQuote: 1000,
  maxVenueExposureQuote: 500,
  maxStrategyExposureQuote: 750,
  maxSlippagePct: 0.6,
  maxDataAgeMs: 20_000,
  minFreeCapitalQuote: 100,
  allowedVenues: ["kraken", "coinbase", "bybit"],
  allowedStrategies: ["cross-exchange-arbitrage"],
  paperModeOnly: true,
};

/**
 * Permanent second lock. `executeLiveOrder()` in src/lib/live.ts is the first.
 * Flipping a settings flag or granting an admin authorization cannot disable this
 * constant: live order placement requires a code change, review and deployment.
 */
export const LIVE_EXECUTION_ENABLED = false as const;

/** A policy that is invalid blocks every intent. Returns the list of problems. */
export function validateRiskPolicy(policy: RiskPolicy): string[] {
  const problems: string[] = [];

  const positive: (keyof RiskPolicy)[] = [
    "maxOrderQuote",
    "maxOrdersPerHour",
    "maxDailyLossQuote",
    "maxTotalExposureQuote",
    "maxVenueExposureQuote",
    "maxStrategyExposureQuote",
    "minFreeCapitalQuote",
  ];
  for (const key of positive) {
    const value = policy[key] as number;
    if (!Number.isFinite(value) || value <= 0) problems.push(`${key} deve essere un numero finito maggiore di zero.`);
  }

  if (!Number.isFinite(policy.maxDrawdownPct) || policy.maxDrawdownPct <= 0 || policy.maxDrawdownPct >= 100) {
    problems.push("maxDrawdownPct deve essere compreso tra 0 e 100 (esclusi).");
  }
  if (!Number.isFinite(policy.maxSlippagePct) || policy.maxSlippagePct < 0) {
    problems.push("maxSlippagePct deve essere un numero finito non negativo.");
  }
  if (!Number.isFinite(policy.maxDataAgeMs) || policy.maxDataAgeMs <= 0) {
    problems.push("maxDataAgeMs deve essere un numero finito maggiore di zero.");
  }
  if (!Array.isArray(policy.allowedVenues) || policy.allowedVenues.length === 0) {
    problems.push("allowedVenues deve elencare almeno una venue autorizzata.");
  }
  if (!Array.isArray(policy.allowedStrategies) || policy.allowedStrategies.length === 0) {
    problems.push("allowedStrategies deve elencare almeno una strategia autorizzata.");
  }
  if (typeof policy.paperModeOnly !== "boolean") {
    problems.push("paperModeOnly deve essere esplicito (true/false).");
  }
  // An order cap above the aggregate exposure cap can never be reached safely.
  if (Number.isFinite(policy.maxOrderQuote) && Number.isFinite(policy.maxTotalExposureQuote) && policy.maxOrderQuote > policy.maxTotalExposureQuote) {
    problems.push("maxOrderQuote non può superare maxTotalExposureQuote.");
  }

  return problems;
}

const finite = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value);

/** Every numeric input must be a finite number: NaN can hide an unbounded limit. */
function incompleteInputs(intent: TradeIntent, portfolio: PortfolioState): string[] {
  const problems: string[] = [];
  const required: [string, unknown][] = [
    ["intent.notionalQuote", intent.notionalQuote],
    ["intent.expectedSlippagePct", intent.expectedSlippagePct],
    ["intent.dataAgeMs", intent.dataAgeMs],
    ["portfolio.dailyRealizedPnlQuote", portfolio.dailyRealizedPnlQuote],
    ["portfolio.peakEquityQuote", portfolio.peakEquityQuote],
    ["portfolio.equityQuote", portfolio.equityQuote],
    ["portfolio.totalExposureQuote", portfolio.totalExposureQuote],
    ["portfolio.availableCapitalQuote", portfolio.availableCapitalQuote],
    ["portfolio.ordersLastHour", portfolio.ordersLastHour],
  ];
  for (const [name, value] of required) {
    if (!finite(value)) problems.push(`${name} non è un numero finito.`);
  }
  if (typeof intent.pair !== "string" || intent.pair.length === 0) problems.push("intent.pair mancante.");
  if (typeof intent.buyVenue !== "string" || intent.buyVenue.length === 0) problems.push("intent.buyVenue mancante.");
  if (typeof intent.sellVenue !== "string" || intent.sellVenue.length === 0) problems.push("intent.sellVenue mancante.");
  if (typeof intent.strategy !== "string" || intent.strategy.length === 0) problems.push("intent.strategy mancante.");
  if (typeof intent.feeVerified !== "boolean") problems.push("intent.feeVerified deve essere esplicito.");
  if (typeof intent.liquidityComplete !== "boolean") problems.push("intent.liquidityComplete deve essere esplicito.");
  return problems;
}

/** Converts a book to its depth-weighted imbalance in [-1, 1]. See indicators.ts. */
export type GuardContext = { now?: number; book?: Book };

/**
 * Evaluate one intent against the policy and the current portfolio state.
 *
 * The result is authoritative: `approved === true` only when zero violations were
 * produced. Callers must treat a non-approved verdict as a hard stop and record
 * `violations[].code` in the audit log.
 */
export function evaluateRisk(input: {
  intent: TradeIntent;
  portfolio: PortfolioState;
  policy: RiskPolicy;
}): RiskVerdict {
  const { intent, portfolio, policy } = input;
  const violations: RiskViolation[] = [];
  const warnings: RiskWarning[] = [];
  let policyRejected = false;

  const policyProblems = validateRiskPolicy(policy);
  if (policyProblems.length > 0) {
    policyRejected = true;
    violations.push({
      code: "POLICY_INVALID",
      message: `Policy di rischio non valida, nessuna operazione consentita: ${policyProblems.join(" ")}`,
    });
  }

  const inputProblems = incompleteInputs(intent, portfolio);
  if (inputProblems.length > 0) {
    violations.push({
      code: "DATA_INCOMPLETE",
      message: `Dati incompleti o non numerici, operazione bloccata: ${inputProblems.join(" ")}`,
    });
  }

  // Nothing below can be trusted with invalid inputs, and a rejected policy must
  // never be combined with numeric comparisons.
  if (violations.length > 0) {
    return { approved: false, violations, warnings, checksEvaluated: 2, policyRejected };
  }

  let checks = 2;

  // --- 1. Kill switches ------------------------------------------------------
  // Only a LIVE intent is refused here; paper intents continue through the other
  // checks. Two independent reasons can refuse it: the operator policy declaring
  // paper-only, and the permanent constant that this build cannot place orders.
  checks += 1;
  if (intent.mode === "live" && (policy.paperModeOnly || !LIVE_EXECUTION_ENABLED)) {
    violations.push({
      code: "LIVE_EXECUTION_DISABLED",
      message:
        "Esecuzione live disabilitata per progetto: il Risk Guard accetta solo intenzioni in paper trading. Nessun ordine reale può essere approvato in questa build.",
    });
  }

  checks += 1;
  if (portfolio.emergencyStop) {
    violations.push({ code: "EMERGENCY_STOP_ACTIVE", message: "Stop di emergenza attivo: nessuna operazione consentita." });
  }

  checks += 1;
  if (portfolio.systemState === "halted") {
    violations.push({ code: "SYSTEM_HALTED", message: "Sistema in stato halted: operatività sospesa." });
  } else if (portfolio.systemState === "degraded") {
    warnings.push({ code: "SYSTEM_DEGRADED", message: "Sistema in stato degraded: operatività permessa ma sorvegliata." });
  }

  // --- 2. Authorizations -----------------------------------------------------
  checks += 1;
  if (!policy.allowedStrategies.includes(intent.strategy)) {
    violations.push({
      code: "STRATEGY_NOT_AUTHORIZED",
      message: `Strategia "${intent.strategy}" non autorizzata dalla policy.`,
    });
  }

  checks += 2;
  if (!policy.allowedVenues.includes(intent.buyVenue)) {
    violations.push({
      code: "BUY_VENUE_NOT_AUTHORIZED",
      message: `Venue di acquisto "${intent.buyVenue}" non autorizzata dalla policy.`,
    });
  }
  if (!policy.allowedVenues.includes(intent.sellVenue)) {
    violations.push({
      code: "SELL_VENUE_NOT_AUTHORIZED",
      message: `Venue di vendita "${intent.sellVenue}" non autorizzata dalla policy.`,
    });
  }

  // --- 3. Order frequency ---------------------------------------------------
  checks += 1;
  if (portfolio.ordersLastHour >= policy.maxOrdersPerHour) {
    violations.push({
      code: "ORDER_RATE_LIMIT",
      message: "Paper opens in the last hour (" + portfolio.ordersLastHour + ") reached the limit " + policy.maxOrdersPerHour + ".",
      limit: policy.maxOrdersPerHour,
      value: portfolio.ordersLastHour,
    });
  }
  // --- 3. Capital and exposure ----------------------------------------------
  checks += 1;
  if (intent.notionalQuote > policy.maxOrderQuote) {
    violations.push({
      code: "ORDER_ABOVE_CAP",
      message: `Notional ${intent.notionalQuote} oltre il limite per ordine ${policy.maxOrderQuote}.`,
      limit: policy.maxOrderQuote,
      value: intent.notionalQuote,
    });
  }

  checks += 1;
  const freeAfterOrder = portfolio.availableCapitalQuote - intent.notionalQuote;
  if (freeAfterOrder < 0) {
    violations.push({
      code: "INSUFFICIENT_CAPITAL",
      message: `Capitale disponibile ${portfolio.availableCapitalQuote} inferiore al notional richiesto ${intent.notionalQuote}.`,
      limit: portfolio.availableCapitalQuote,
      value: intent.notionalQuote,
    });
  } else if (freeAfterOrder < policy.minFreeCapitalQuote) {
    violations.push({
      code: "INSUFFICIENT_CAPITAL",
      message: `Dopo l'ordine resterebbero ${freeAfterOrder} di capitale libero, sotto il minimo ${policy.minFreeCapitalQuote}.`,
      limit: policy.minFreeCapitalQuote,
      value: freeAfterOrder,
    });
  }

  checks += 1;
  const totalAfter = portfolio.totalExposureQuote + intent.notionalQuote;
  if (totalAfter > policy.maxTotalExposureQuote) {
    violations.push({
      code: "TOTAL_EXPOSURE_LIMIT",
      message: `Esposizione totale ${totalAfter} oltre il limite ${policy.maxTotalExposureQuote}.`,
      limit: policy.maxTotalExposureQuote,
      value: totalAfter,
    });
  }

  // Exposure is checked on both legs: the bought asset sits on the buy venue and
  // the sale settles on the sell venue, so both venues carry the same notional.
  checks += 1;
  for (const venue of [intent.buyVenue, intent.sellVenue]) {
    const current = portfolio.venueExposureQuote[venue] ?? 0;
    const after = current + intent.notionalQuote;
    if (after > policy.maxVenueExposureQuote) {
      violations.push({
        code: "VENUE_EXPOSURE_LIMIT",
        message: `Esposizione su ${venue} ${after} oltre il limite ${policy.maxVenueExposureQuote}.`,
        limit: policy.maxVenueExposureQuote,
        value: after,
      });
    }
  }

  checks += 1;
  const strategyAfter = (portfolio.strategyExposureQuote[intent.strategy] ?? 0) + intent.notionalQuote;
  if (strategyAfter > policy.maxStrategyExposureQuote) {
    violations.push({
      code: "STRATEGY_EXPOSURE_LIMIT",
      message: `Esposizione della strategia ${intent.strategy} a ${strategyAfter} oltre il limite ${policy.maxStrategyExposureQuote}.`,
      limit: policy.maxStrategyExposureQuote,
      value: strategyAfter,
    });
  }

  // --- 4. Loss limits -------------------------------------------------------
  checks += 1;
  const loss = -portfolio.dailyRealizedPnlQuote;
  if (loss >= policy.maxDailyLossQuote) {
    violations.push({
      code: "DAILY_LOSS_LIMIT",
      message: `Perdita giornaliera ${loss} ha raggiunto il limite ${policy.maxDailyLossQuote}: trading sospeso fino al reset.`,
      limit: policy.maxDailyLossQuote,
      value: loss,
    });
  } else if (loss >= policy.maxDailyLossQuote * 0.8) {
    warnings.push({
      code: "NEAR_DAILY_LOSS_LIMIT",
      message: `Perdita giornaliera ${loss} all'80% o più del limite ${policy.maxDailyLossQuote}.`,
      limit: policy.maxDailyLossQuote,
      value: loss,
    });
  }

  checks += 1;
  if (portfolio.peakEquityQuote > 0) {
    const drawdownPct = ((portfolio.peakEquityQuote - portfolio.equityQuote) / portfolio.peakEquityQuote) * 100;
    if (drawdownPct >= policy.maxDrawdownPct) {
      violations.push({
        code: "DRAWDOWN_LIMIT",
        message: `Drawdown ${drawdownPct.toFixed(2)}% ha raggiunto il limite ${policy.maxDrawdownPct}%.`,
        limit: policy.maxDrawdownPct,
        value: drawdownPct,
      });
    } else if (drawdownPct >= policy.maxDrawdownPct * 0.8) {
      warnings.push({
        code: "NEAR_DRAWDOWN_LIMIT",
        message: `Drawdown ${drawdownPct.toFixed(2)}% all'80% o più del limite ${policy.maxDrawdownPct}%.`,
        limit: policy.maxDrawdownPct,
        value: drawdownPct,
      });
    }
  }

  if (intent.notionalQuote > policy.maxOrderQuote * 0.9 && intent.notionalQuote <= policy.maxOrderQuote) {
    warnings.push({
      code: "NEAR_ORDER_CAP",
      message: `Notional ${intent.notionalQuote} oltre il 90% del limite per ordine ${policy.maxOrderQuote}.`,
      limit: policy.maxOrderQuote,
      value: intent.notionalQuote,
    });
  }

  // --- 5. Data integrity ----------------------------------------------------
  checks += 1;
  if (!intent.feeVerified) {
    violations.push({
      code: "FEE_UNVERIFIED",
      message: "Commissione taker non verificata: un costo sconosciuto non può produrre un segnale eseguibile.",
    });
  }

  checks += 1;
  if (!finite(intent.dataAgeMs) || intent.dataAgeMs > policy.maxDataAgeMs) {
    violations.push({
      code: "STALE_DATA",
      message: `Dati di mercato obsoleti (${intent.dataAgeMs}ms > ${policy.maxDataAgeMs}ms).`,
      limit: policy.maxDataAgeMs,
      value: intent.dataAgeMs,
    });
  } else if (intent.dataAgeMs < 0) {
    violations.push({
      code: "STALE_DATA",
      message: `Timestamp dei dati nel futuro (${intent.dataAgeMs}ms): book non affidabile.`,
      value: intent.dataAgeMs,
    });
  }

  checks += 1;
  if (!intent.liquidityComplete) {
    violations.push({
      code: "INSUFFICIENT_LIQUIDITY",
      message: "Profondità insufficiente su una delle due gambe: riempimento non garantito.",
    });
  }

  checks += 1;
  if (!finite(intent.expectedSlippagePct) || intent.expectedSlippagePct > policy.maxSlippagePct) {
    violations.push({
      code: "SLIPPAGE_LIMIT",
      message: `Slippage atteso ${intent.expectedSlippagePct}% oltre la tolleranza ${policy.maxSlippagePct}%.`,
      limit: policy.maxSlippagePct,
      value: intent.expectedSlippagePct,
    });
  }

  return {
    approved: violations.length === 0,
    violations,
    warnings,
    checksEvaluated: checks,
    policyRejected,
  };
}

/**
 * Convenience helper for UI and workers: a one-line, audit-safe summary.
 * Never used to *approve* anything — approval is always `verdict.approved`.
 */
export function summarizeVerdict(verdict: RiskVerdict): string {
  if (verdict.approved) {
    return `Approvato dal Risk Guard (${verdict.checksEvaluated} controlli, ${verdict.warnings.length} avvisi).`;
  }
  const codes = verdict.violations.map((v) => v.code).join(", ");
  return `Bloccato dal Risk Guard: ${codes}.`;
}
