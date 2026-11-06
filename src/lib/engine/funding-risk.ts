/**
 * Risk checks specific to the delta-neutral carry, on top of the Risk Guard.
 *
 * The Risk Guard answers "is this order allowed by the portfolio limits?". It cannot
 * answer the two questions that only exist for a two-leg position:
 *
 * 1. Are the legs actually balanced? A 10% oversized perpetual leg is a directional
 *    bet wearing a hedge costume.
 * 2. Which venue's market data is being used, and are we allowed to use it here?
 *
 * Both are checked here and both fail closed. Portfolio limits are not re-implemented:
 * they are delegated, so there is exactly one authority for them.
 *
 * Every numeric field is validated at runtime: TypeScript disappears at the boundary,
 * so a NaN coming from a database row or an HTTP body would otherwise pass the
 * comparisons below (every comparison with NaN is false and the limit is skipped).
 */

import {
  blockedVerdict,
  evaluateRisk,
  type PortfolioState,
  type RiskPolicy,
  type RiskVerdict,
  type TradeIntent,
} from "./risk-guard";
import { marketDataDisplayDecision, type DeploymentContext } from "../venues/licensing";
import { FUNDING_CARRY_STRATEGY } from "./funding";

export type FundingRiskCode =
  | "INPUT_INVALID"
  | "SLIPPAGE_INVALID"
  | "LEG_NOTIONAL_INVALID"
  | "LEG_IMBALANCE"
  | "NEGATIVE_FUNDING"
  | "LIQUIDATION_BUFFER"
  | "LICENCE_BLOCKED";

export type FundingRiskViolation = { code: FundingRiskCode; message: string };

export type DeltaNeutralRiskInput = {
  venueId: string;
  pair: string;
  spotNotionalQuote: number;
  perpNotionalQuote: number;
  fundingRate: number;
  liquidationBufferPct: number;
  minLiquidationBufferPct: number;
  /** Maximum accepted difference between the two legs, percent of the larger leg. */
  maxImbalancePct: number;
  allowNegativeFunding: boolean;
  dataAgeMs: number;
  /**
   * Depth-weighted slippage measured by the engine for this size, percent. There is
   * no default: a missing value is not zero slippage.
   */
  expectedSlippagePct: number;
  feeVerified: boolean;
  liquidityComplete: boolean;
  portfolio: PortfolioState;
  policy: RiskPolicy;
  /** `internal` for the operator's own analysis, `customer-facing` for any user. */
  context: DeploymentContext;
};

export type DeltaNeutralRiskResult = {
  approved: boolean;
  fundingViolations: FundingRiskViolation[];
  /** The delegated portfolio verdict, always evaluated. */
  verdict: RiskVerdict;
  /** |spot - perp| / max(legs), percent. */
  imbalancePct: number;
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const CONTEXTS: readonly DeploymentContext[] = ["internal", "customer-facing"];

/** Sane domains. A value outside them is a broken feed, not a business decision. */
const MAX_NOTIONAL_QUOTE = 1_000_000_000_000;
const MAX_SLIPPAGE_PCT = 100;
const MAX_FUNDING_RATE = 1; // 100% per interval is already absurd for a carry.
const MAX_DATA_AGE_MS = 24 * 60 * 60 * 1000;
const SYSTEM_STATES = ["operational", "degraded", "halted"] as const;

const PORTFOLIO_NUMBERS = [
  "dailyRealizedPnlQuote",
  "peakEquityQuote",
  "equityQuote",
  "totalExposureQuote",
  "availableCapitalQuote",
  "ordersLastHour",
] as const;

const POLICY_NUMBERS = [
  "maxOrderQuote",
  "maxOrdersPerHour",
  "maxDailyLossQuote",
  "maxDrawdownPct",
  "maxTotalExposureQuote",
  "maxVenueExposureQuote",
  "maxStrategyExposureQuote",
  "maxSlippagePct",
  "maxDataAgeMs",
  "minFreeCapitalQuote",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Runtime validation of everything this module reads. It is separate from the
 * individual checks so that one bad field cannot silently disable its own limit,
 * and so a structural problem is reported as such instead of as a business rule.
 */
function invalidInputs(input: DeltaNeutralRiskInput): string[] {
  const problems: string[] = [];

  if (typeof input.venueId !== "string" || input.venueId.trim() === "") {
    problems.push("venueId mancante.");
  }
  if (typeof input.pair !== "string" || input.pair.trim() === "") {
    problems.push("pair mancante.");
  }

  const required: [string, unknown][] = [
    ["spotNotionalQuote", input.spotNotionalQuote],
    ["perpNotionalQuote", input.perpNotionalQuote],
    ["fundingRate", input.fundingRate],
    ["liquidationBufferPct", input.liquidationBufferPct],
    ["minLiquidationBufferPct", input.minLiquidationBufferPct],
    ["maxImbalancePct", input.maxImbalancePct],
    ["dataAgeMs", input.dataAgeMs],
  ];
  for (const [name, value] of required) {
    if (!finite(value)) problems.push(`${name} non è un numero finito.`);
  }

  if (finite(input.minLiquidationBufferPct) && input.minLiquidationBufferPct < 0) {
    problems.push("minLiquidationBufferPct non può essere negativo.");
  }
  if (finite(input.maxImbalancePct) && (input.maxImbalancePct < 0 || input.maxImbalancePct > 100)) {
    problems.push("maxImbalancePct deve essere compreso tra 0 e 100.");
  }
  if (finite(input.dataAgeMs) && input.dataAgeMs < 0) {
    problems.push("dataAgeMs non può essere negativo: un'età negativa è un timestamp nel futuro.");
  }
  if (finite(input.dataAgeMs) && input.dataAgeMs > MAX_DATA_AGE_MS) {
    problems.push(`dataAgeMs oltre ${MAX_DATA_AGE_MS} ms: dati non utilizzabili.`);
  }

  // Semantic bounds: a value outside these ranges cannot describe a real carry.
  for (const name of ["spotNotionalQuote", "perpNotionalQuote"] as const) {
    const value = input[name];
    if (finite(value) && value > MAX_NOTIONAL_QUOTE) {
      problems.push(`${name} oltre ${MAX_NOTIONAL_QUOTE}: nozionale non plausibile.`);
    }
  }
  if (finite(input.fundingRate) && Math.abs(input.fundingRate) > MAX_FUNDING_RATE) {
    problems.push(`fundingRate fuori intervallo [-${MAX_FUNDING_RATE}, ${MAX_FUNDING_RATE}].`);
  }
  if (finite(input.liquidationBufferPct) && (input.liquidationBufferPct <= -100 || input.liquidationBufferPct > 100)) {
    problems.push("liquidationBufferPct deve essere compreso tra -100 (escluso) e 100.");
  }
  if (finite(input.minLiquidationBufferPct) && input.minLiquidationBufferPct > 100) {
    problems.push("minLiquidationBufferPct non può superare 100.");
  }

  if (typeof input.allowNegativeFunding !== "boolean") {
    problems.push("allowNegativeFunding deve essere esplicito (true/false).");
  }
  if (typeof input.feeVerified !== "boolean") {
    problems.push("feeVerified deve essere esplicito (true/false).");
  }
  if (typeof input.liquidityComplete !== "boolean") {
    problems.push("liquidityComplete deve essere esplicito (true/false).");
  }
  if (!CONTEXTS.includes(input.context)) {
    problems.push(`context deve essere uno tra ${CONTEXTS.join(", ")}.`);
  }

  if (!isRecord(input.portfolio)) {
    problems.push("portfolio mancante.");
  }
  if (!isRecord(input.policy)) {
    problems.push("policy mancante.");
  }

  return problems;
}

/**
 * Structural validation of the nested portfolio and policy. The Risk Guard
 * validates them again, but this module must refuse an incomplete object before
 * calling it: a missing map or a string where a number belongs used to fall
 * through to a permissive comparison.
 */
function structureProblems(input: DeltaNeutralRiskInput): string[] {
  const problems: string[] = [];
  if (!isRecord(input.portfolio)) return ["portfolio mancante."];
  if (!isRecord(input.policy)) return ["policy mancante."];

  for (const key of PORTFOLIO_NUMBERS) {
    if (!finite(input.portfolio[key])) problems.push(`portfolio.${key} non è un numero finito.`);
  }
  if (typeof input.portfolio.emergencyStop !== "boolean") {
    problems.push("portfolio.emergencyStop deve essere esplicito (true/false).");
  }
  if (!SYSTEM_STATES.includes(input.portfolio.systemState)) {
    problems.push(`portfolio.systemState deve essere uno tra ${SYSTEM_STATES.join(", ")}.`);
  }
  for (const key of ["venueExposureQuote", "strategyExposureQuote"] as const) {
    const map = input.portfolio[key];
    if (!isRecord(map)) {
      problems.push(`portfolio.${key} deve essere una mappa di importi.`);
      continue;
    }
    for (const [venue, value] of Object.entries(map)) {
      if (!finite(value) || value < 0) {
        problems.push(`portfolio.${key}["${venue}"] deve essere un numero finito non negativo.`);
      }
    }
  }

  for (const key of POLICY_NUMBERS) {
    if (!finite(input.policy[key])) problems.push(`policy.${key} non è un numero finito.`);
  }
  for (const key of ["allowedVenues", "allowedStrategies"] as const) {
    const list = input.policy[key];
    if (!Array.isArray(list) || list.length === 0 || list.some((item) => typeof item !== "string" || item.trim() === "")) {
      problems.push(`policy.${key} deve elencare almeno una stringa non vuota.`);
    }
  }
  if (typeof input.policy.paperModeOnly !== "boolean") {
    problems.push("policy.paperModeOnly deve essere esplicito (true/false).");
  }

  return problems;
}

/**
 * Evaluate a delta-neutral carry against the venue licence, the leg balance, the
 * funding direction, the liquidation buffer and the portfolio policy.
 */
export function evaluateDeltaNeutralRisk(input: DeltaNeutralRiskInput): DeltaNeutralRiskResult {
  const fundingViolations: FundingRiskViolation[] = [];

  const problems = invalidInputs(input);
  if (problems.length > 0) {
    fundingViolations.push({
      code: "INPUT_INVALID",
      message: `Input non validi, nessuna approvazione possibile: ${problems.join(" ")}`,
    });
  }

  // A proxy, a getter or a corrupt object can throw while being read. Structural
  // validation must become a blocking reason, never an unhandled exception.
  let structure: string[];
  try {
    structure = structureProblems(input);
  } catch {
    structure = ["portfolio o policy non leggibili."];
  }
  if (structure.length > 0) {
    fundingViolations.push({
      code: "INPUT_INVALID",
      message: `Portfolio o policy incompleti: ${structure.join(" ")}`,
    });
  }

  // Slippage is checked on its own so that the failure names the missing measurement
  // instead of hiding inside the generic input list. It is never defaulted to zero.
  const slippageValid =
    finite(input.expectedSlippagePct) &&
    input.expectedSlippagePct >= 0 &&
    input.expectedSlippagePct <= MAX_SLIPPAGE_PCT;
  if (!slippageValid) {
    fundingViolations.push({
      code: "SLIPPAGE_INVALID",
      message: `Slippage atteso non valido (${String(input.expectedSlippagePct)}): va misurato sulla profondità, non assunto nullo.`,
    });
  }

  // Without a usable portfolio or policy the guard cannot be called at all; returning
  // a blocking verdict is safer than letting it throw on a corrupt persisted state.
  if (
    structure.length > 0 ||
    problems.some((problem) => problem === "portfolio mancante." || problem === "policy mancante.")
  ) {
    return {
      approved: false,
      fundingViolations,
      verdict: blockedVerdict("DATA_INCOMPLETE", "Portfolio o policy incompleti: Risk Guard non eseguibile."),
      imbalancePct: Number.POSITIVE_INFINITY,
    };
  }

  if (input.context === "internal" || input.context === "customer-facing") {
    const licence = marketDataDisplayDecision(input.venueId, input.context);
    if (!licence.allowed) {
      fundingViolations.push({ code: "LICENCE_BLOCKED", message: licence.reason });
    }
  }

  const legsValid =
    finite(input.spotNotionalQuote) &&
    finite(input.perpNotionalQuote) &&
    input.spotNotionalQuote > 0 &&
    input.perpNotionalQuote > 0;
  if (!legsValid) {
    fundingViolations.push({
      code: "LEG_NOTIONAL_INVALID",
      message: "Le due gambe devono avere un nozionale finito maggiore di zero: una gamba assente non è delta-neutral.",
    });
  }

  const largerLeg = legsValid ? Math.max(input.spotNotionalQuote, input.perpNotionalQuote) : Number.POSITIVE_INFINITY;
  const imbalancePct = legsValid
    ? (Math.abs(input.spotNotionalQuote - input.perpNotionalQuote) / largerLeg) * 100
    : Number.POSITIVE_INFINITY;

  if (finite(input.maxImbalancePct) && imbalancePct > input.maxImbalancePct) {
    fundingViolations.push({
      code: "LEG_IMBALANCE",
      message: `Squilibrio tra le gambe ${imbalancePct.toFixed(2)}% oltre il massimo ${input.maxImbalancePct}%: la posizione non è più delta-neutral.`,
    });
  }

  if (input.allowNegativeFunding === false && finite(input.fundingRate) && input.fundingRate < 0) {
    fundingViolations.push({
      code: "NEGATIVE_FUNDING",
      message: `Funding negativo (${input.fundingRate}): la gamba short paga il funding, il carry non incassa.`,
    });
  }

  if (
    finite(input.liquidationBufferPct) &&
    finite(input.minLiquidationBufferPct) &&
    input.liquidationBufferPct < input.minLiquidationBufferPct
  ) {
    fundingViolations.push({
      code: "LIQUIDATION_BUFFER",
      message: `Buffer di liquidazione ${input.liquidationBufferPct}% sotto il minimo ${input.minLiquidationBufferPct}%.`,
    });
  }

  // The guard receives the larger leg: the capital at risk is never understated by
  // averaging a small spot leg with a large perpetual one. An invalid measurement is
  // passed as Infinity so the guard's own slippage check blocks it as well.
  const intent: TradeIntent = {
    pair: input.pair,
    buyVenue: input.venueId,
    sellVenue: input.venueId,
    strategy: FUNDING_CARRY_STRATEGY,
    notionalQuote: largerLeg,
    expectedSlippagePct: slippageValid ? input.expectedSlippagePct : Number.POSITIVE_INFINITY,
    feeVerified: input.feeVerified,
    dataAgeMs: input.dataAgeMs,
    liquidityComplete: input.liquidityComplete,
    // Simulation only: this module can never express a live intent.
    mode: "paper",
  };

  // A getter, a proxy or a corrupt object can still throw inside the guard. An
  // exception must become a blocking verdict, never an unhandled error that a
  // caller could mistake for "not evaluated".
  let verdict: RiskVerdict;
  try {
    verdict = evaluateRisk({ intent, portfolio: input.portfolio, policy: input.policy });
  } catch {
    return {
      approved: false,
      fundingViolations: [
        ...fundingViolations,
        { code: "INPUT_INVALID", message: "Il Risk Guard non è eseguibile su portfolio o policy corrotti." },
      ],
      verdict: blockedVerdict("DATA_INCOMPLETE", "Risk Guard non eseguibile: portfolio o policy corrotti."),
      imbalancePct,
    };
  }

  return {
    approved: verdict.approved && fundingViolations.length === 0,
    fundingViolations,
    verdict,
    imbalancePct,
  };
}
