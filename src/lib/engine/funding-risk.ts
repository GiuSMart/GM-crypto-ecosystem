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

  if (input.portfolio === null || typeof input.portfolio !== "object" || Array.isArray(input.portfolio)) {
    problems.push("portfolio mancante.");
  }
  if (input.policy === null || typeof input.policy !== "object" || Array.isArray(input.policy)) {
    problems.push("policy mancante.");
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

  // Slippage is checked on its own so that the failure names the missing measurement
  // instead of hiding inside the generic input list. It is never defaulted to zero.
  const slippageValid = finite(input.expectedSlippagePct) && input.expectedSlippagePct >= 0;
  if (!slippageValid) {
    fundingViolations.push({
      code: "SLIPPAGE_INVALID",
      message: `Slippage atteso non valido (${String(input.expectedSlippagePct)}): va misurato sulla profondità, non assunto nullo.`,
    });
  }

  // Without a usable portfolio or policy the guard cannot be called at all; returning
  // a blocking verdict is safer than letting it throw on a corrupt persisted state.
  if (problems.some((problem) => problem === "portfolio mancante." || problem === "policy mancante.")) {
    return {
      approved: false,
      fundingViolations,
      verdict: blockedVerdict("DATA_INCOMPLETE", "Portfolio o policy mancanti: Risk Guard non eseguibile."),
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

  const verdict = evaluateRisk({ intent, portfolio: input.portfolio, policy: input.policy });

  return {
    approved: verdict.approved && fundingViolations.length === 0,
    fundingViolations,
    verdict,
    imbalancePct,
  };
}
